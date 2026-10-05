"use client"

import useSWR from "swr"

import { api, ApiError, getCsrfToken } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

// Media memories: images, PDFs, video and audio a brain has read. The brain stores the file,
// the OCR service reads it (text in any script, PDF pages, video keyframes, speech) and the
// text is indexed through a companion note, so recall finds it.

export type MediaKind = "image" | "pdf" | "video" | "audio"
export type MediaStatus = "pending" | "processing" | "done" | "failed"

export type MediaLine = { text: string; score: number; box: [number, number][]; script?: string }
export type MediaSegment = {
  kind: "image" | "page" | "frame" | "speech"
  page?: number
  start?: number
  end?: number
  text: string
  lines?: MediaLine[]
  width?: number
  height?: number
}
export type MediaText = { width?: number; height?: number; duration?: number; segments: MediaSegment[] }

export type Media = {
  id: string
  namespace: string
  noteId?: string
  kind: MediaKind
  name: string
  contentType: string
  bytes: number
  digest: string
  status: MediaStatus
  error?: string
  result?: MediaText
  url: string
  createdAt: string
  updatedAt: string
}

export const MEDIA_ACCEPT =
  "image/png,image/jpeg,image/webp,image/bmp,application/pdf,video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.mov,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,audio/aac,audio/flac,.m4a,.flac"

const busy = (s?: MediaStatus) => s === "pending" || s === "processing"

/** A brain's media, newest first. Polls while anything is still being read. */
export function useMediaList(namespace: string | null | undefined, kind?: string) {
  return useSWR<{ items: Media[]; total: number; reader: boolean }>(
    namespace ? ["/api/brain/media", namespace, kind ?? ""] : null,
    ([, ns, k]: [string, string, string]) =>
      api(`/api/brain/media?${new URLSearchParams({ namespace: ns, ...(k ? { kind: k } : {}), limit: "120" })}`),
    { ...noRetryOn4xx, refreshInterval: (d) => (d?.items.some((m) => busy(m.status)) ? 3_000 : 30_000) },
  )
}

/** One media file with its reader result. Polls while it is being read. */
export function useMedia(id: string | null | undefined) {
  return useSWR<Media>(id ? ["/api/brain/media/item", id] : null, ([, i]: [string, string]) => api(`/api/brain/media/${encodeURIComponent(i)}`), {
    ...noRetryOn4xx,
    refreshInterval: (m) => (busy(m?.status) ? 2_500 : 0),
  })
}

/** Upload one file with progress (XHR: fetch has no upload progress). */
export async function uploadMedia(namespace: string, file: Blob, filename: string, onProgress?: (pct: number | null) => void): Promise<Media> {
  const token = await getCsrfToken()
  const form = new FormData()
  form.append("namespace", namespace)
  form.append("file", file, filename)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/brain/media")
    xhr.withCredentials = true
    xhr.setRequestHeader("X-CSRF-Token", token)
    xhr.setRequestHeader("Accept", "application/json")
    xhr.upload.onprogress = (e) => onProgress?.(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null)
    xhr.onerror = () => reject(new ApiError(0, "Network error"))
    xhr.onload = () => {
      let body: { error?: { message?: string }; message?: string } & Partial<Media> = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Media)
      else reject(new ApiError(xhr.status, body.error?.message ?? body.message ?? xhr.statusText))
    }
    xhr.send(form)
  })
}

export const mediaApi = {
  remove: (id: string) => api<void>(`/api/brain/media/${encodeURIComponent(id)}`, { method: "DELETE" }),
  reprocess: (id: string) => api<Media>(`/api/brain/media/${encodeURIComponent(id)}/reprocess`, { method: "POST" }),
}

/** The live-camera websocket on this origin. */
export function liveMediaURL(namespace: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/api/brain/media/live?namespace=${encodeURIComponent(namespace)}`
}

// --- Phone camera pairing --------------------------------------------------------------------
// The desktop shows a one-time QR code; the phone that scans it gets a camera-only pass to this
// one brain (no sign-in on the phone). The pass lives in the phone's sessionStorage.

export type CameraPairing = {
  id: string
  namespace: string
  code?: string
  status: "waiting" | "connected" | "expired" | "ended"
  device?: string
  expiresAt: string
  connectedAt?: string
}

export const cameraPairingApi = {
  create: (namespace: string) => api<CameraPairing>("/api/brain/media/pair", { json: { namespace } }),
  end: (id: string) => api<void>(`/api/brain/media/pair/${encodeURIComponent(id)}`, { method: "DELETE" }),
}

/** A pairing's state, polled while the QR waits for a phone. */
export function useCameraPairing(id: string | null | undefined) {
  return useSWR<CameraPairing>(id ? ["/api/brain/media/pair", id] : null, ([, i]: [string, string]) => api(`/api/brain/media/pair/${encodeURIComponent(i)}`), {
    ...noRetryOn4xx,
    refreshInterval: (p) => (!p || p.status === "waiting" ? 2_000 : p.status === "connected" ? 15_000 : 0),
  })
}

/** The link the QR code carries. The code rides in the #fragment, so it never reaches a server
 * log or a Referer; the phone page reads and spends it. */
export function cameraLink(locale: string, code: string): string {
  return `${window.location.origin}/${locale}/cam#${code}`
}

const CAM_KEY = "zekra.cam"

async function camFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: "application/json", "X-Zekra-Camera": token, ...init.headers }, cache: "no-store" })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? res.statusText)
  return body as T
}

export const cameraPass = {
  stored: (): string | null => (typeof window === "undefined" ? null : sessionStorage.getItem(CAM_KEY)),
  forget: () => sessionStorage.removeItem(CAM_KEY),
  /** End the pass on the server too (the phone leaves). */
  end: (token: string) => camFetch<void>("/api/brain/media/cam/session", token, { method: "DELETE" }).catch(() => undefined),
  /** Spend the QR code once; keeps the pass for this tab. */
  redeem: async (code: string) => {
    const res = await fetch("/api/brain/media/cam/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? res.statusText)
    sessionStorage.setItem(CAM_KEY, body.token)
    return body as { token: string; namespace: string; expiresAt: string }
  },
  session: (token: string) => camFetch<{ namespace: string; expiresAt: string; reader: boolean }>("/api/brain/media/cam/session", token),
  media: (token: string, id: string) => camFetch<Media>(`/api/brain/media/cam/media/${encodeURIComponent(id)}`, token),
  upload: async (token: string, namespace: string, file: Blob, filename: string) => {
    const form = new FormData()
    form.append("namespace", namespace)
    form.append("file", file, filename)
    return camFetch<Media>("/api/brain/media/cam/upload", token, { method: "POST", body: form })
  },
  liveURL: (token: string, namespace: string) => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${proto}//${window.location.host}/api/brain/media/cam/live?${new URLSearchParams({ namespace, cam: token })}`
  },
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function clock(sec = 0): string {
  const t = Math.round(sec)
  const mm = String(Math.floor(t / 60) % 60)
  const ss = String(t % 60).padStart(2, "0")
  return t >= 3600 ? `${Math.floor(t / 3600)}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`
}
