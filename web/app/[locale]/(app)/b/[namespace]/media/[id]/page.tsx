"use client"

import { Badge, Button, Card, CardContent, toast } from "@fadymondy/nasaq/web"

import { useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon, RefreshCwIcon, StickyNoteIcon } from "lucide-react"

import { ConfirmButton } from "@/components/confirm-button"
import { BoxOverlay } from "@/components/media/box-overlay"
import { MEDIA_ICONS, statusVariant } from "@/components/media/kind-icon"
import { DetailStrip, PageBody, Panel, SectionHeader } from "@/components/page"
import { ErrorState, LoadingRows } from "@/components/states"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { clock, mediaApi, useMedia, type MediaSegment } from "@/lib/media"
import { useDocumentTitle } from "@/lib/title"

function formatBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"]
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

/** One media file: the file itself (image with its read text boxes, PDF, video or audio player)
 * beside what the reader found — lines, pages, keyframes and the transcript. Times seek the player. */
export default function MediaViewerPage() {
  const { t, formatDate } = useTranslations()
  const router = useRouter()
  const params = useParams<{ namespace: string; id: string }>()
  const namespace = decodeURIComponent(params.namespace)
  const { data: m, error, isLoading, mutate } = useMedia(params.id)
  useDocumentTitle(m ? `${m.name} · ${namespace}` : t("media.title"))
  const player = useRef<HTMLMediaElement | null>(null)
  const [active, setActive] = useState<number | undefined>()
  const base = `/b/${encodeURIComponent(namespace)}`

  const errText = (err: unknown) => (err instanceof ApiError ? err.message : t("common.networkError"))
  const seek = (s?: number) => {
    if (player.current && s !== undefined) {
      player.current.currentTime = s
      void player.current.play()
    }
  }

  if (error)
    return (
      <PageBody>
        <ErrorState error={error} />
      </PageBody>
    )
  if (isLoading || !m)
    return (
      <PageBody>
        <LoadingRows rows={6} />
      </PageBody>
    )

  const media = m
  const Icon = MEDIA_ICONS[media.kind]
  const segs = media.result?.segments ?? []
  const text = segs.filter((s) => s.kind !== "speech" && s.text.trim())
  const speech = segs.filter((s) => s.kind === "speech")
  const image = segs.find((s) => s.kind === "image")
  const reading = media.status === "pending" || media.status === "processing"

  async function reprocess() {
    try {
      await mediaApi.reprocess(media.id)
      void mutate()
    } catch (err) {
      toast.error(errText(err))
    }
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" nativeButton={false} render={<Link href={`${base}/media`} />}>
        <ArrowLeftIcon className="rtl:rotate-180" /> {t("media.title")}
      </Button>
      {media.noteId ? (
        <Button variant="secondary" nativeButton={false} render={<Link href={`${base}/notes?id=${media.noteId}`} />}>
          <StickyNoteIcon /> {t("media.openNote")}
        </Button>
      ) : null}
      <Button variant="secondary" nativeButton={false} render={<a href={media.url} download={media.name} />}>
        <DownloadIcon /> {t("media.download")}
      </Button>
      <Button variant="secondary" disabled={reading} onClick={reprocess}>
        <RefreshCwIcon /> {t("media.reprocess")}
      </Button>
      <ConfirmButton
        label={t("common.delete")}
        title={t("media.confirmDelete")}
        description={t("media.confirmDeleteBody")}
        confirmLabel={t("common.delete")}
        onConfirm={async () => {
          try {
            await mediaApi.remove(media.id)
            router.push(`${base}/media`)
          } catch (err) {
            toast.error(errText(err))
          }
        }}
      />
    </div>
  )

  return (
    <div>
      <SectionHeader micro={t(`media.kind.${media.kind}`)} title={media.name} action={actions} />
      <PageBody>
        <DetailStrip
          items={[
            { label: t("media.statusLabel"), value: <Badge variant={statusVariant(media.status)}>{t(`media.status.${media.status}`)}</Badge> },
            { label: t("media.size"), value: <span dir="ltr">{formatBytes(media.bytes)}</span> },
            ...(media.result?.duration ? [{ label: t("media.duration"), value: <span dir="ltr">{clock(media.result.duration)}</span> }] : []),
            { label: t("media.added"), value: formatDate(media.createdAt, { dateStyle: "medium", timeStyle: "short" }) },
          ]}
        />

        {media.status === "failed" ? (
          <div className="rounded-xl border border-nq-danger/30 bg-nq-danger/5 px-4 py-3 text-sm">{media.error || t("media.failed")}</div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="overflow-hidden p-0">
            <CardContent className="flex items-center justify-center bg-nq-hover p-3">
              {media.kind === "image" ? (
                <div className="relative inline-block max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={media.url} alt={media.name} className="block max-h-[70vh] max-w-full rounded-lg" />
                  {image?.lines ? (
                    <BoxOverlay lines={image.lines} width={image.width || media.result?.width || 0} height={image.height || media.result?.height || 0} active={active} />
                  ) : null}
                </div>
              ) : media.kind === "video" ? (
                <video ref={(el) => void (player.current = el)} src={media.url} controls className="max-h-[70vh] w-full rounded-lg" />
              ) : media.kind === "audio" ? (
                <div className="flex w-full flex-col items-center gap-4 py-8">
                  <span className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--nq-action)_14%,transparent)] text-nq-action">
                    <Icon className="size-8" />
                  </span>
                  <audio ref={(el) => void (player.current = el)} src={media.url} controls className="w-full" />
                </div>
              ) : (
                <iframe src={media.url} title={media.name} className="h-[70vh] w-full rounded-lg bg-white" />
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            {reading ? (
              <Card>
                <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" /> {t("media.reading")}
                </CardContent>
              </Card>
            ) : null}

            {text.length > 0 ? (
              <Panel title={media.kind === "image" ? t("media.textFound") : media.kind === "pdf" ? t("media.pages") : t("media.onScreen")}>
                {media.kind === "image" && image?.lines?.length ? (
                  <ul className="flex flex-col gap-1">
                    {image.lines.map((l, i) => (
                      <li
                        key={i}
                        dir="auto"
                        onMouseEnter={() => setActive(i)}
                        onMouseLeave={() => setActive(undefined)}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-nq-hover"
                      >
                        <span className="min-w-0 flex-1">{l.text}</span>
                        {l.script ? <Badge variant="outline">{l.script}</Badge> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {text.map((s, i) => (
                      <SegmentRow key={i} s={s} onSeek={seek} label={s.kind === "page" ? t("media.page", { n: s.page ?? i + 1 }) : clock(s.start)} />
                    ))}
                  </ul>
                )}
              </Panel>
            ) : null}

            {speech.length > 0 ? (
              <Panel title={t("media.transcript")}>
                <ul className="flex flex-col gap-1">
                  {speech.map((s, i) => (
                    <SegmentRow key={i} s={s} onSeek={seek} label={clock(s.start)} />
                  ))}
                </ul>
              </Panel>
            ) : null}

            {media.status === "done" && text.length === 0 && speech.length === 0 ? (
              <Card>
                <CardContent className="text-sm text-muted-foreground">{t("media.noText")}</CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </PageBody>
    </div>
  )
}

function SegmentRow({ s, label, onSeek }: { s: MediaSegment; label: string; onSeek: (t?: number) => void }) {
  const seekable = s.kind === "frame" || s.kind === "speech"
  return (
    <li className="flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-nq-hover">
      {seekable ? (
        <button type="button" dir="ltr" onClick={() => onSeek(s.start)} className="shrink-0 font-mono text-xs text-nq-action hover:underline">
          {label}
        </button>
      ) : (
        <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      )}
      <p dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
        {s.text}
      </p>
    </li>
  )
}
