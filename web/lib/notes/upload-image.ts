/*
Client for the note image endpoint added in plugins/brain/note_images.go.

Kept out of the editor component so paste, drop and a file picker can all share
one code path, and so the limits stay stated in one place.
*/

/** Mirrors maxNoteImageBytes in note_images.go. Checked here to fail fast. */
export const MAX_IMAGE_BYTES = 8 << 20

/** The server sniffs the bytes; this list only avoids a pointless round trip. */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"]

export interface UploadedImage {
  url: string
  digest: string
  bytes: number
  contentType: string
}

export class ImageUploadError extends Error {}

export async function uploadNoteImage(file: File | Blob, namespace: string): Promise<UploadedImage> {
  if (!namespace) throw new ImageUploadError("no brain selected")
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageUploadError(`Image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
  }
  // SVG is rejected server-side because it executes script in our origin; say
  // so here rather than letting the upload fail with a bare 415.
  if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new ImageUploadError(
      file.type === "image/svg+xml" ? "SVG images are not accepted" : `Unsupported image type: ${file.type}`,
    )
  }

  const form = new FormData()
  form.append("namespace", namespace)
  // A pasted Blob has no filename; the server ignores it but multipart wants one.
  form.append("file", file, file instanceof File ? file.name : "pasted.png")

  const res = await fetch("/api/notes/image", {
    method: "POST",
    body: form,
    credentials: "include",
    headers: csrfHeader(),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new ImageUploadError(detail?.message || detail?.error || `Upload failed (${res.status})`)
  }
  return (await res.json()) as UploadedImage
}

/**
 * The brain's write routes require the CSRF pair (see noteWriteGuard), and the
 * token is a readable cookie rather than a header the app already sets.
 */
function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {}
  const match = document.cookie.match(/(?:^|;\s*)togo_csrf=([^;]+)/)
  return match ? { "X-CSRF-Token": decodeURIComponent(match[1]) } : {}
}

/** Pull image files out of a paste or drop event, ignoring everything else. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (file && file.type.startsWith("image/")) out.push(file)
  }
  // Some browsers expose a screenshot only through files, not items.
  if (out.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith("image/")) out.push(file)
    }
  }
  return out
}
