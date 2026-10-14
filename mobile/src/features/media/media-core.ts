import type { Media, MediaKind, MediaLine, MediaSegment, MediaStatus } from "./types";

/*
Pure logic for the media feature: no React, no RN, so it runs under
`node --test` (media-core.test.ts). Only type imports above — node erases
them, so the file needs no path aliases at runtime.
*/

export const KINDS: MediaKind[] = ["image", "pdf", "video", "audio"];

/** Content types the server accepts (mediaTypes in media.go), plus the
 *  aliases phones report for the same formats. */
const TYPES: Record<string, MediaKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/webp": "image",
  "image/bmp": "image",
  "application/pdf": "pdf",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/x-matroska": "video",
  "video/avi": "video",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/wav": "audio",
  "audio/wave": "audio",
  "audio/x-wav": "audio",
  "audio/ogg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/m4a": "audio",
  "audio/webm": "audio",
  "audio/aac": "audio",
  "audio/flac": "audio",
  "audio/x-flac": "audio",
};

const EXT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/avi",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

/** The picker's MIME types for the document picker (PDF and audio; images and
 *  video come from the camera / photo library). */
export const DOCUMENT_TYPES = ["application/pdf", "audio/*"];

/** Default upload caps per kind (media.go mediaDefaultMB); the server has the last word. */
export const MAX_MB: Record<MediaKind, number> = { image: 40, pdf: 200, video: 1024, audio: 512 };

export function isKind(v: string): v is MediaKind {
  return (KINDS as string[]).includes(v);
}

export function extOf(name: string): string {
  const base = name.split(/[?#]/)[0].split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A picked file as the multipart part to send, or why it cannot be sent.
 *  The type comes from the picker when it knows one the server reads, else from
 *  the extension; the name always carries an extension. */
export function uploadPart(
  asset: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null },
  fallbackName = "media",
): { part: { uri: string; name: string; type: string }; kind: MediaKind } | { error: "type" | "size"; kind?: MediaKind } {
  const rawName = (asset.name ?? "").trim() || (asset.uri.split(/[?#]/)[0].split("/").pop() ?? "");
  const declared = (asset.mimeType ?? "").toLowerCase().split(";")[0].trim();
  const ext = extOf(rawName);
  const type = TYPES[declared] ? declared : EXT_TYPES[ext] ?? "";
  const kind = TYPES[type];
  if (!kind) return { error: "type" };
  if (asset.size && asset.size > MAX_MB[kind] * 1024 * 1024) return { error: "size", kind };
  const wanted = Object.entries(EXT_TYPES).find(([, t]) => t === type)?.[0] ?? "bin";
  const name = ext && EXT_TYPES[ext] && TYPES[EXT_TYPES[ext]] === kind ? rawName : `${stem(rawName) || fallbackName}.${wanted}`;
  return { part: { uri: asset.uri, name, type }, kind };
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

// ─── Status ─────────────────────────────────────────────────────────────────

export function isBusy(s?: MediaStatus | string): boolean {
  return s === "pending" || s === "processing";
}

/** How often to poll: quickly while anything is being read, else rarely (or never). */
export function listInterval(items: Pick<Media, "status">[] | undefined): number {
  return items?.some((m) => isBusy(m.status)) ? 3_000 : 30_000;
}
export function itemInterval(m: Pick<Media, "status"> | undefined): number | false {
  return m && isBusy(m.status) ? 2_500 : false;
}

export function statusTone(s: string): "ok" | "warn" | "danger" | "muted" {
  return s === "done" ? "ok" : s === "failed" ? "danger" : isBusy(s) ? "warn" : "muted";
}

export function countByKind(items: Pick<Media, "kind">[]): Record<MediaKind, number> {
  const out: Record<MediaKind, number> = { image: 0, pdf: 0, video: 0, audio: 0 };
  for (const m of items) if (isKind(m.kind)) out[m.kind]++;
  return out;
}

// ─── Reader result ──────────────────────────────────────────────────────────

export type ReadText = {
  /** Image lines (with their script), when the file is an image. */
  lines: MediaLine[];
  /** Pages (PDF) or on-screen keyframes (video). */
  text: MediaSegment[];
  /** Speech, from video or audio. */
  speech: MediaSegment[];
};

/** What the reader found, split the way the viewer shows it. */
export function readText(m: Pick<Media, "kind" | "result">): ReadText {
  const segs = m.result?.segments ?? [];
  const image = segs.find((s) => s.kind === "image");
  return {
    lines: m.kind === "image" ? (image?.lines ?? []).filter((l) => l.text.trim()) : [],
    text: segs.filter((s) => s.kind !== "speech" && s.kind !== "image" && s.text.trim()).concat(
      m.kind !== "image" || !image?.lines?.length ? segs.filter((s) => s.kind === "image" && s.text.trim()) : [],
    ),
    speech: segs.filter((s) => s.kind === "speech" && s.text.trim()),
  };
}

export function hasText(r: ReadText): boolean {
  return r.lines.length > 0 || r.text.length > 0 || r.speech.length > 0;
}

/** All of it as plain text (Copy text): lines, then pages/frames, then the transcript. */
export function plainText(r: ReadText): string {
  return [...r.lines.map((l) => l.text), ...r.text.map((s) => s.text.trim()), ...r.speech.map((s) => s.text.trim())]
    .filter(Boolean)
    .join("\n");
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** 75 → "1:15", 3725 → "1:02:05". */
export function clock(sec = 0): string {
  const t = Math.max(0, Math.round(sec));
  const mm = String(Math.floor(t / 60) % 60);
  const ss = String(t % 60).padStart(2, "0");
  return t >= 3600 ? `${Math.floor(t / 3600)}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/** 1536 → "1.5 KB". */
export function formatBytes(n: number): string {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = Math.max(0, n);
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** The list query string the API takes. */
export function listQuery(namespace: string, kind: MediaKind | "all", limit = 120): string {
  const q = new URLSearchParams({ namespace, limit: String(limit) });
  if (kind !== "all") q.set("kind", kind);
  return q.toString();
}

/** Files the share sheet / viewer gets: a safe name that keeps the extension. */
export function localFileName(m: Pick<Media, "id" | "name">): string {
  const clean = m.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim();
  return clean || `media-${m.id}`;
}
