"use client"

// Per-brain settings: the profile (display name, description, colour, icon, avatar / cover),
// plus the membership endpoints the settings page manages. Keys start with /api/brain/ so the
// shared realtime stream revalidates them on every `brain` event (profile changes emit one).
import useSWR from "swr"

import { api } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

/** The profile fields every brain list item carries (GET /api/brain/namespaces, /mine). */
export type ProfileSummary = {
  displayName?: string
  description?: string
  color?: string
  colorHex?: string
  icon?: string
  imageUrl?: string
}

export type BrainProfile = Required<ProfileSummary> & {
  namespace: string
  coverUrl: string
  visibility: "private" | "internal"
  defaultNoteCategory: string
  settings: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
  /** false = defaults; the brain has never been configured. */
  persisted: boolean
}

/** full = owner/admin; limited = editor (description and color only); none = read-only. */
export type EditLevel = "full" | "limited" | "none"
export type PaletteColor = { key: string; hex: string }
export type ProfileResponse = { profile: BrainProfile; edit: EditLevel; palette: PaletteColor[] }

export type ProfilePatch = Partial<
  Pick<BrainProfile, "displayName" | "description" | "color" | "icon" | "imageUrl" | "coverUrl" | "visibility" | "defaultNoteCategory">
>

export type MemberRole = "owner" | "editor" | "viewer"
export type Member = { namespace: string; userId: string; role: MemberRole }

export type ImageKind = "image" | "cover"

const enc = encodeURIComponent
export const profileKey = (ns: string) => `/api/brain/profile?namespace=${enc(ns)}`
export const membersKey = (ns: string) => `/api/brain/members?namespace=${enc(ns)}`

/** The server palette (kept in sync with profile.go); used before the profile has loaded. */
export const PALETTE: PaletteColor[] = [
  { key: "slate", hex: "#64748b" }, { key: "red", hex: "#ef4444" }, { key: "orange", hex: "#f97316" },
  { key: "amber", hex: "#f59e0b" }, { key: "lime", hex: "#84cc16" }, { key: "green", hex: "#22c55e" },
  { key: "teal", hex: "#14b8a6" }, { key: "cyan", hex: "#06b6d4" }, { key: "blue", hex: "#3b82f6" },
  { key: "indigo", hex: "#6366f1" }, { key: "violet", hex: "#8b5cf6" }, { key: "pink", hex: "#ec4899" },
]

export const HEX_RE = /^#[0-9a-f]{6}$/i

/** A palette key or #hex to a hex ("" when neither). */
export function resolveColor(c: string | undefined | null): string {
  if (!c) return ""
  const p = PALETTE.find((x) => x.key === c)
  if (p) return p.hex
  return HEX_RE.test(c) ? c.toLowerCase() : ""
}

export const profileApi = {
  get: (ns: string) => api<ProfileResponse>(profileKey(ns)),
  update: (namespace: string, patch: ProfilePatch) =>
    api<ProfileResponse>("/api/brain/profile", { method: "PATCH", json: { namespace, ...patch } }),
  uploadImage: (namespace: string, kind: ImageKind, file: Blob, filename: string) => {
    const form = new FormData()
    form.set("namespace", namespace)
    form.set("kind", kind)
    form.set("file", file, filename)
    return api<{ url: string; profile: BrainProfile }>("/api/brain/profile/image", { form })
  },
  removeImage: (namespace: string, kind: ImageKind) =>
    api<{ removed: boolean; profile: BrainProfile }>(`/api/brain/profile/image?namespace=${enc(namespace)}&kind=${kind}`, {
      method: "DELETE",
    }),
  members: (ns: string) => api<{ namespace: string; members: Member[] }>(membersKey(ns)),
  setMember: (body: { namespace: string; email?: string; userId?: string; role: MemberRole }) =>
    api<Member>("/api/brain/members", { json: body }),
  removeMember: (body: { namespace: string; userId: string }) =>
    api<{ removed: boolean }>("/api/brain/members/remove", { json: body }),
  createBrain: (body: { namespace: string; displayName?: string; color?: string; description?: string }) =>
    api<{ namespace: string; role: string }>("/api/brain/brains", { json: body }),
}

export function useBrainProfile(ns: string | null | undefined) {
  return useSWR<ProfileResponse>(ns ? profileKey(ns) : null, () => profileApi.get(ns!), noRetryOn4xx)
}

/** The brain's entity types (note categories) for the default-category select. */
export function useBrainOntology(ns: string | null | undefined) {
  return useSWR<{ entityTypes: { name: string }[] }>(
    ns ? `/api/brain/ontology?namespace=${enc(ns)}` : null,
    () => api<{ entityTypes: { name: string }[] }>(`/api/brain/ontology?namespace=${enc(ns!)}`),
    noRetryOn4xx,
  )
}

export function useMembers(ns: string | null | undefined, enabled = true) {
  return useSWR<Member[]>(ns && enabled ? membersKey(ns) : null, () => profileApi.members(ns!).then((r) => r.members ?? []), noRetryOn4xx)
}

const AVATAR_PX = 512
const MAX_BYTES = 2 * 1024 * 1024
export const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp"

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("image"))
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Prepare an upload in the browser: the avatar is centre-cropped to a 512px square; a cover
 *  is scaled down to 1600px wide. Both re-encode to WebP (PNG when the browser cannot), which
 *  also strips metadata. Returns null when the file is not a readable raster image. */
export async function prepareImage(file: File, kind: ImageKind): Promise<{ blob: Blob; name: string } | null> {
  if (!ACCEPTED_IMAGES.split(",").includes(file.type)) return null
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    return null
  }
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return file.size <= MAX_BYTES ? { blob: file, name: file.name } : null
  if (kind === "image") {
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const out = Math.min(AVATAR_PX, side)
    canvas.width = canvas.height = out
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
  } else {
    const scale = Math.min(1, 1600 / img.naturalWidth)
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  }
  URL.revokeObjectURL(img.src)
  const webp = await toBlob(canvas, "image/webp", 0.9)
  const blob = webp && webp.type === "image/webp" ? webp : await toBlob(canvas, "image/png", 1)
  if (!blob || blob.size > MAX_BYTES) return null
  return { blob, name: `${kind}.${blob.type === "image/webp" ? "webp" : "png"}` }
}
