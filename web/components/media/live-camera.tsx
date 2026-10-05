"use client"

import { Badge, Button, Card, CardContent, toast } from "@fadymondy/nasaq/web"

import { useCallback, useEffect, useRef, useState } from "react"
import { CameraIcon, CameraOffIcon, CopyIcon, SaveIcon, SwitchCameraIcon } from "lucide-react"

import { BoxOverlay } from "@/components/media/box-overlay"
import { Panel } from "@/components/page"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import type { MediaLine } from "@/lib/media"

type Frame = { width: number; height: number; lines: MediaLine[]; text: string; ms?: number }

const MAX_SIDE = 1280 // frames are scaled down before sending; plenty for OCR, light on the wire
const INTERVAL = 600 // ms between frames; the server drops near-identical ones and any that pile up

/** Live camera: frames stream over a websocket to the OCR service, which answers with the text
 * it sees; boxes are drawn over the video. "Remember" saves the current frame through onSave.
 * Used by the console's live page and by the paired phone (/cam), which differ only in how they
 * authenticate: wsURL and onSave carry that. */
export function LiveCamera({
  wsURL,
  onSave,
  autoStart = false,
}: {
  wsURL: () => string
  onSave: (blob: Blob, filename: string) => Promise<void>
  autoStart?: boolean
}) {
  const { t } = useTranslations()
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const inflight = useRef(false)
  const [running, setRunning] = useState(false)
  const [facing, setFacing] = useState<"environment" | "user">("environment")
  const [frame, setFrame] = useState<Frame | null>(null)
  const [state, setState] = useState<"idle" | "connecting" | "live" | "error">("idle")
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [boxAspect, setBoxAspect] = useState(16 / 9)

  // The video area is portrait on a phone and wide on a desktop; the overlay follows it.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientHeight && setBoxAspect(el.clientWidth / el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stop = useCallback(() => {
    ws.current?.close()
    ws.current = null
    stream.current?.getTracks().forEach((tr) => tr.stop())
    stream.current = null
    inflight.current = false
    setRunning(false)
    setState("idle")
  }, [])

  useEffect(() => stop, [stop])

  /** Draw the current video frame, scaled, into the shared canvas. */
  const grab = useCallback((): HTMLCanvasElement | null => {
    const v = video.current
    if (!v || !v.videoWidth) return null
    const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight))
    const c = (canvas.current ??= document.createElement("canvas"))
    c.width = Math.round(v.videoWidth * k)
    c.height = Math.round(v.videoHeight * k)
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height)
    return c
  }, [])

  const start = useCallback(
    async (mode: "environment" | "user") => {
      stop()
      setState("connecting")
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1920 } }, audio: false })
        stream.current = s
        if (video.current) {
          video.current.srcObject = s
          await video.current.play()
        }
      } catch {
        setState("error")
        toast.error(t("media.cameraDenied"))
        return
      }
      const sock = new WebSocket(wsURL())
      sock.binaryType = "arraybuffer"
      sock.onopen = () => {
        setState("live")
        setRunning(true)
      }
      sock.onerror = () => setState("error")
      sock.onclose = () => {
        if (ws.current === sock) {
          setState((st) => (st === "live" ? "error" : st))
          setRunning(false)
        }
      }
      sock.onmessage = (e) => {
        inflight.current = false
        try {
          const r = JSON.parse(String(e.data)) as Frame & { same?: boolean }
          if (!r.same) setFrame(r)
        } catch {
          /* ignore */
        }
      }
      ws.current = sock
    },
    [stop, t, wsURL],
  )

  // The phone opens straight into the camera. Browsers may still want a tap first; then the
  // Start button is there.
  useEffect(() => {
    if (autoStart) void start("environment")
  }, [autoStart, start])

  // The send loop: one frame in flight at a time.
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      const sock = ws.current
      if (!sock || sock.readyState !== WebSocket.OPEN || inflight.current) return
      const c = grab()
      if (!c) return
      inflight.current = true
      c.toBlob((b) => (b ? void b.arrayBuffer().then((buf) => sock.send(buf)) : (inflight.current = false)), "image/jpeg", 0.85)
    }, INTERVAL)
    return () => window.clearInterval(id)
  }, [running, grab])

  async function remember() {
    const c = grab()
    if (!c) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.92))
      if (!blob) throw new Error("capture failed")
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")
      await onSave(blob, `camera-${stamp}.jpg`)
      toast.success(t("media.saved"))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setSaving(false)
    }
  }

  function flip() {
    const next = facing === "environment" ? "user" : "environment"
    setFacing(next)
    if (running) void start(next)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="overflow-hidden p-0">
        <CardContent className="flex flex-col gap-3 p-3">
          <div ref={box} className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-black sm:aspect-video">
            <video ref={video} playsInline muted className="size-full object-contain" />
            {running && frame ? (
              // The overlay box must match the drawn video area: object-contain keeps the aspect,
              // so the SVG uses the same aspect and centring.
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className="relative max-h-full max-w-full"
                  style={{ aspectRatio: `${frame.width} / ${frame.height}`, ...(frame.width / frame.height > boxAspect ? { width: "100%" } : { height: "100%" }) }}
                >
                  <BoxOverlay lines={frame.lines} width={frame.width} height={frame.height} />
                </div>
              </div>
            ) : null}
            {!running ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                <CameraIcon className="size-10" />
                <span className="text-sm">{state === "error" ? t("media.liveError") : t("media.liveIdle")}</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="secondary" onClick={stop}>
                <CameraOffIcon /> {t("media.stop")}
              </Button>
            ) : (
              <Button variant="primary" disabled={state === "connecting"} onClick={() => void start(facing)}>
                <CameraIcon /> {t("media.start")}
              </Button>
            )}
            <Button variant="secondary" onClick={flip} aria-label={t("media.flip")}>
              <SwitchCameraIcon /> {t("media.flip")}
            </Button>
            <Button variant="primary" disabled={!running || saving} onClick={remember}>
              <SaveIcon /> {t("media.remember")}
            </Button>
            <Badge variant={state === "live" ? "success" : state === "error" ? "danger" : "outline"} className="ms-auto">
              {t(`media.liveState.${state}`)}
              {state === "live" && frame?.ms !== undefined ? <span dir="ltr"> · {frame.ms} ms</span> : null}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Panel
        title={t("media.textFound")}
        action={
          frame?.text ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(frame.text).then(() => toast.success(t("media.copied")))}
            >
              <CopyIcon /> {t("media.copy")}
            </Button>
          ) : null
        }
      >
        {frame?.lines.length ? (
          <ul className="flex flex-col gap-1">
            {frame.lines.map((l, i) => (
              <li key={i} dir="auto" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1">{l.text}</span>
                {l.script ? <Badge variant="outline">{l.script}</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("media.liveNoText")}</p>
        )}
      </Panel>
    </div>
  )
}
