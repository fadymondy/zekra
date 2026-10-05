import { FileTextIcon, ImageIcon, MusicIcon, VideoIcon, type LucideIcon } from "lucide-react"

import type { MediaKind } from "@/lib/media"

export const MEDIA_ICONS: Record<MediaKind, LucideIcon> = { image: ImageIcon, pdf: FileTextIcon, video: VideoIcon, audio: MusicIcon }

export function statusVariant(s: string) {
  return s === "done" ? "success" : s === "failed" ? "danger" : "info"
}
