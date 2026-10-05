"""zekra-ocr — the media reader behind Zekra's media memories.

One small HTTP service that turns pixels and sound into text the brain can index:

  POST /v1/ocr     an image            -> lines (text, score, box, script) + joined text
  POST /v1/pdf     a PDF               -> per-page text (embedded text layer first, OCR for scans)
  POST /v1/video   a video             -> scene-change keyframes OCR'd (+ speech transcript)
  POST /v1/audio   an audio file       -> speech transcript segments
  WS   /v1/live    JPEG frames in      -> lines out, for the live camera overlay
  GET  /health

Recognition is PP-OCRv5: one text detector, then every configured recogniser
(Chinese/English/Japanese, Arabic, Latin, Cyrillic, Devanagari, Korean, ...) reads
each detected line and the most confident reading wins. That is how a single
request reads any script, mixed scripts included, without the caller naming the
language. Speech uses faster-whisper. Everything is configured from env so the
model mix can change without a rebuild.
"""

from __future__ import annotations

import asyncio
import io
import os
import subprocess
import tempfile
import threading
import time
import unicodedata
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect

TOKEN = os.getenv("OCR_TOKEN", "")
DEVICE = os.getenv("OCR_DEVICE", "gpu")  # gpu | cpu
DET_MODEL = os.getenv("OCR_DET_MODEL", "PP-OCRv5_server_det")
REC_MODELS = [m.strip() for m in os.getenv(
    "OCR_REC_MODELS",
    "PP-OCRv5_server_rec,arabic_PP-OCRv5_mobile_rec,latin_PP-OCRv5_mobile_rec,"
    "cyrillic_PP-OCRv5_mobile_rec,devanagari_PP-OCRv5_mobile_rec,korean_PP-OCRv5_mobile_rec",
).split(",") if m.strip()]
MIN_SCORE = float(os.getenv("OCR_MIN_SCORE", "0.5"))
MAX_SIDE = int(os.getenv("OCR_MAX_SIDE", "2048"))
ASR_MODEL = os.getenv("OCR_ASR_MODEL", "large-v3-turbo")  # empty disables speech
VIDEO_SCENE = float(os.getenv("OCR_VIDEO_SCENE", "0.25"))
VIDEO_EVERY = float(os.getenv("OCR_VIDEO_EVERY", "5"))  # also sample at least every N seconds
VIDEO_MAX_FRAMES = int(os.getenv("OCR_VIDEO_MAX_FRAMES", "240"))
PDF_DPI = int(os.getenv("OCR_PDF_DPI", "200"))
# keyframes on scene change, plus a floor of one every VIDEO_EVERY seconds
_SELECT = rf"select='gt(scene\,{VIDEO_SCENE})+isnan(prev_selected_t)+gte(t-prev_selected_t\,{VIDEO_EVERY})'"

app = FastAPI(title="zekra-ocr")
_lock = threading.Lock()  # paddle predictors are not thread-safe
_det = None
_recs: list[tuple[str, Any]] = []
_asr = None


def _models():
    global _det, _recs
    if _det is None:
        from paddleocr import TextDetection, TextRecognition

        _det = TextDetection(model_name=DET_MODEL, device=DEVICE)
        _recs = [(name, TextRecognition(model_name=name, device=DEVICE)) for name in REC_MODELS]
    return _det, _recs


def _asr_model():
    global _asr
    if _asr is None and ASR_MODEL:
        from faster_whisper import WhisperModel

        dev = "cuda" if DEVICE == "gpu" else "cpu"
        _asr = WhisperModel(ASR_MODEL, device=dev, compute_type="float16" if dev == "cuda" else "int8")
    return _asr


def _auth(authorization: str | None):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")


# ---------------------------------------------------------------- image OCR


def _decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(415, "not a readable image")
    return img


def _fit(img: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    s = min(1.0, MAX_SIDE / max(h, w))
    if s < 1.0:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img, s


def _crop(img: np.ndarray, poly: np.ndarray) -> np.ndarray:
    pts = poly.astype(np.float32)
    w = int(max(np.linalg.norm(pts[0] - pts[1]), np.linalg.norm(pts[2] - pts[3])))
    h = int(max(np.linalg.norm(pts[0] - pts[3]), np.linalg.norm(pts[1] - pts[2])))
    w, h = max(w, 1), max(h, 1)
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    out = cv2.warpPerspective(img, cv2.getPerspectiveTransform(pts, dst), (w, h), borderMode=cv2.BORDER_REPLICATE)
    if h > w * 1.5:  # vertical line
        out = np.rot90(out)
    return out


def _script(text: str) -> str:
    counts: dict[str, int] = {}
    for ch in text:
        if not ch.isalpha():
            continue
        name = unicodedata.name(ch, "")
        key = name.split(" ")[0] if name else "OTHER"
        counts[key] = counts.get(key, 0) + 1
    return max(counts, key=counts.get).lower() if counts else ""


def _order(lines: list[dict]) -> list[dict]:
    """Reading order: top-to-bottom bands, then left-to-right (right-to-left when the
    band is mostly Arabic/Hebrew)."""
    if not lines:
        return lines
    for ln in lines:
        ys = [p[1] for p in ln["box"]]
        ln["_y"], ln["_h"] = sum(ys) / 4, max(ys) - min(ys)
        ln["_x"] = sum(p[0] for p in ln["box"]) / 4
    lines.sort(key=lambda l: l["_y"])
    bands: list[list[dict]] = []
    for ln in lines:
        if bands and abs(bands[-1][-1]["_y"] - ln["_y"]) < 0.6 * max(ln["_h"], bands[-1][-1]["_h"], 1):
            bands[-1].append(ln)
        else:
            bands.append([ln])
    out = []
    for band in bands:
        rtl = sum(1 for l in band if l["script"] in ("arabic", "hebrew")) * 2 > len(band)
        band.sort(key=lambda l: -l["_x"] if rtl else l["_x"])
        out.extend(band)
    for ln in out:
        for k in ("_y", "_h", "_x"):
            ln.pop(k, None)
    return out


def ocr_image(img: np.ndarray) -> dict:
    img, s = _fit(img)
    det, recs = _models()
    with _lock:
        d = det.predict(img, batch_size=1)[0]
        polys = [np.asarray(p) for p in d["dt_polys"]]
        if not polys:
            return {"width": img.shape[1], "height": img.shape[0], "lines": [], "text": ""}
        crops = [_crop(img, p) for p in polys]
        best = [("", 0.0, "")] * len(crops)
        for name, rec in recs:
            for i, r in enumerate(rec.predict(crops, batch_size=16)):
                text, score = r["rec_text"], float(r["rec_score"])
                if score > best[i][1]:
                    best[i] = (text, score, name)
    lines = []
    for poly, (text, score, model) in zip(polys, best):
        text = text.strip()
        if not text or score < MIN_SCORE:
            continue
        lines.append({
            "text": text,
            "score": round(score, 4),
            "box": [[round(float(x) / s, 1), round(float(y) / s, 1)] for x, y in poly.tolist()],
            "script": _script(text),
            "model": model,
        })
    lines = _order(lines)
    return {
        "width": round(img.shape[1] / s),
        "height": round(img.shape[0] / s),
        "lines": lines,
        "text": "\n".join(l["text"] for l in lines),
    }


# ---------------------------------------------------------------- helpers


def _dhash(img: np.ndarray) -> int:
    g = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (9, 8), interpolation=cv2.INTER_AREA)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def _near(a: int, b: int, bits: int = 6) -> bool:
    return bin(a ^ b).count("1") <= bits


def _transcribe(path: str) -> list[dict]:
    model = _asr_model()
    if model is None:
        return []
    segs, _info = model.transcribe(path, vad_filter=True)
    return [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs if s.text.strip()]


async def _read(file: UploadFile, limit_mb: int) -> bytes:
    data = await file.read()
    if len(data) > limit_mb * 1024 * 1024:
        raise HTTPException(413, f"over {limit_mb} MB")
    return data


# ---------------------------------------------------------------- routes


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "det": DET_MODEL, "rec": REC_MODELS, "asr": ASR_MODEL or None}


@app.post("/v1/ocr")
async def ocr(file: UploadFile = File(...), authorization: str | None = Header(None)):
    _auth(authorization)
    img = _decode(await _read(file, 40))
    t = time.perf_counter()
    out = await asyncio.to_thread(ocr_image, img)
    out["ms"] = round((time.perf_counter() - t) * 1000)
    return out


@app.post("/v1/pdf")
async def pdf(file: UploadFile = File(...), authorization: str | None = Header(None), max_pages: int = Query(300)):
    _auth(authorization)
    data = await _read(file, 200)

    def run():
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(data)
        pages = []
        for i in range(min(len(doc), max_pages)):
            page = doc[i]
            layer = page.get_textpage().get_text_range().strip()
            if len(layer) >= 40:  # a real text layer: trust it, skip OCR
                pages.append({"page": i + 1, "text": layer, "source": "text", "lines": []})
                continue
            bmp = page.render(scale=PDF_DPI / 72).to_numpy()
            img = cv2.cvtColor(bmp, cv2.COLOR_RGBA2BGR if bmp.shape[2] == 4 else cv2.COLOR_RGB2BGR)
            r = ocr_image(img)
            pages.append({"page": i + 1, "text": r["text"], "source": "ocr", "lines": r["lines"],
                          "width": r["width"], "height": r["height"]})
        return {"pages": pages, "count": len(doc)}

    return await asyncio.to_thread(run)


@app.post("/v1/video")
async def video(file: UploadFile = File(...), authorization: str | None = Header(None), speech: bool = Query(True)):
    _auth(authorization)
    data = await _read(file, 2048)

    def run():
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "in")
            with open(src, "wb") as f:
                f.write(data)
            # keyframes on scene change, plus a floor of one every VIDEO_EVERY seconds
            p = subprocess.run(
                ["ffmpeg", "-hide_banner", "-i", src, "-vf", f"{_SELECT},showinfo", "-vsync", "vfr",
                 "-frames:v", str(VIDEO_MAX_FRAMES), os.path.join(tmp, "f%05d.jpg")],
                check=True, capture_output=True, text=True,
            )
            times = [round(float(l.split("pts_time:")[1].split()[0]), 2) for l in p.stderr.splitlines() if "pts_time:" in l]
            frames, last, last_text = [], None, ""
            for i, name in enumerate(sorted(n for n in os.listdir(tmp) if n.startswith("f"))):
                img = cv2.imread(os.path.join(tmp, name))
                h = _dhash(img)
                if last is not None and _near(h, last):
                    continue
                last = h
                r = ocr_image(img)
                if not r["text"] or r["text"] == last_text:
                    continue
                last_text = r["text"]
                frames.append({"t": times[i] if i < len(times) else None, "text": r["text"], "lines": r["lines"]})
            segments = _transcribe(src) if speech else []
            return {"frames": frames, "speech": segments, "duration": _duration(src)}

    try:
        return await asyncio.to_thread(run)
    except subprocess.CalledProcessError as e:
        raise HTTPException(415, f"ffmpeg: {(e.stderr or '')[-300:]}")


def _duration(src: str) -> float | None:
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                       capture_output=True, text=True)
    try:
        return round(float(p.stdout.strip()), 2)
    except ValueError:
        return None


@app.post("/v1/audio")
async def audio(file: UploadFile = File(...), authorization: str | None = Header(None)):
    _auth(authorization)
    if not ASR_MODEL:
        raise HTTPException(501, "speech disabled (OCR_ASR_MODEL empty)")
    data = await _read(file, 1024)

    def run():
        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
            f.write(data)
            path = f.name
        try:
            return {"speech": _transcribe(path), "duration": _duration(path)}
        finally:
            os.unlink(path)

    return await asyncio.to_thread(run)


@app.websocket("/v1/live")
async def live(ws: WebSocket):
    """Binary JPEG frames in, OCR results out. Frames that look like the last one
    are answered with {"same": true} so a steady camera costs almost nothing, and
    frames that arrive while one is being read are dropped (latest wins)."""
    if TOKEN and ws.query_params.get("token") != TOKEN and ws.headers.get("authorization") != f"Bearer {TOKEN}":
        await ws.close(code=4401)
        return
    await ws.accept()
    last = None
    try:
        while True:
            data = await ws.receive_bytes()
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            h = _dhash(img)
            if last is not None and _near(h, last, 3):
                await ws.send_json({"same": True})
                continue
            last = h
            t = time.perf_counter()
            r = await asyncio.to_thread(ocr_image, img)
            r["ms"] = round((time.perf_counter() - t) * 1000)
            await ws.send_json(r)
    except WebSocketDisconnect:
        return


@app.on_event("startup")
async def warm():
    # Load models off the request path; first boot downloads them into the cache volume.
    await asyncio.to_thread(_models)
    blank = np.full((64, 256, 3), 255, np.uint8)
    cv2.putText(blank, "zekra", (10, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3)
    await asyncio.to_thread(ocr_image, blank)
