"use client"

import { Button, Dropzone, Toggle, ToggleGroup, UploadList, toast, type UploadFile } from "@fadymondy/nasaq/web"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { CameraIcon, CircleAlertIcon, FileTextIcon, ImageIcon, LayersIcon, MusicIcon, VideoIcon } from "lucide-react"

import { MediaTile } from "@/components/media/media-tile"
import { PhoneCameraButton } from "@/components/media/phone-camera"
import { PageBody, Panel, SectionHeader, StatStrip } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { MEDIA_ACCEPT, uploadMedia, useMediaList } from "@/lib/media"
import { useDocumentTitle } from "@/lib/title"

const KINDS = ["", "image", "pdf", "video", "audio"] as const

export default function BrainMediaPage() {
  const { t, formatNumber } = useTranslations()
  const params = useParams<{ namespace: string }>()
  const namespace = decodeURIComponent(params.namespace)
  useDocumentTitle(`${t("media.title")} · ${namespace}`)

  const [kind, setKind] = useState<string>("")
  const [uploads, setUploads] = useState<UploadFile[]>([])
  const media = useMediaList(namespace, kind)
  const items = media.data?.items ?? []
  const all = useMediaList(namespace)
  const counts = (k: string) => (all.data?.items ?? []).filter((m) => m.kind === k).length

  const patch = (id: string, p: Partial<UploadFile>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)))

  async function send(item: UploadFile) {
    patch(item.id, { status: "uploading", progress: 0, error: undefined })
    try {
      const m = await uploadMedia(namespace, item.file, item.file.name, (pct) => patch(item.id, { progress: pct }))
      patch(item.id, { status: "done", progress: 100 })
      if (m.status === "done") toast.info(t("media.duplicate", { name: m.name }))
      void media.mutate()
      void all.mutate()
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== item.id)), 2500)
    } catch (err) {
      patch(item.id, { status: "error", error: err instanceof ApiError ? err.message : t("common.networkError") })
    }
  }

  function onFiles(files: File[]) {
    const next = files.map((file) => ({ id: crypto.randomUUID(), file, status: "pending" as const, progress: null }))
    setUploads((u) => [...u, ...next])
    next.forEach((it) => void send(it))
  }

  const liveButton = (
    <div className="flex flex-wrap gap-2">
      <PhoneCameraButton namespace={namespace} />
      <Button variant="primary" nativeButton={false} render={<Link href={`/b/${encodeURIComponent(namespace)}/media/live`} />}>
        <CameraIcon /> {t("media.live")}
      </Button>
    </div>
  )

  return (
    <div>
      <SectionHeader micro={t("media.micro")} title={t("media.title")} description={t("media.description")} action={liveButton} />

      <PageBody>
        {media.data && !media.data.reader ? (
          <div className="flex items-center gap-2 rounded-xl border border-nq-danger/30 bg-nq-danger/5 px-4 py-3 text-sm text-foreground">
            <CircleAlertIcon className="size-4 shrink-0 text-nq-danger" /> {t("media.noReader")}
          </div>
        ) : null}

        {(all.data?.items.length ?? 0) > 0 ? (
          <StatStrip
            items={[
              { icon: <ImageIcon />, label: t("media.kind.image"), value: formatNumber(counts("image")) },
              { icon: <FileTextIcon />, label: t("media.kind.pdf"), value: formatNumber(counts("pdf")) },
              { icon: <VideoIcon />, label: t("media.kind.video"), value: formatNumber(counts("video")) },
              { icon: <MusicIcon />, label: t("media.kind.audio"), value: formatNumber(counts("audio")) },
            ]}
          />
        ) : null}

        <Panel title={t("media.upload")} hint={t("media.uploadHint")}>
          <div className="flex flex-col gap-3">
            <Dropzone accept={MEDIA_ACCEPT} onFiles={onFiles} onReject={(r) => r.length && toast.error(t("media.rejected", { n: formatNumber(r.length) }))} />
            <UploadList items={uploads} onRetry={(it) => void send(it)} onRemove={(it) => setUploads((u) => u.filter((x) => x.id !== it.id))} />
          </div>
        </Panel>

        <Panel
          title={t("media.library")}
          action={
            <ToggleGroup aria-label={t("media.filter")} variant="outline" value={[kind]} onValueChange={(v: string[]) => setKind(v[0] ?? "")}>
              {KINDS.map((k) => (
                <Toggle key={k || "all"} value={k}>
                  {k ? t(`media.kind.${k}`) : <><LayersIcon /> {t("media.all")}</>}
                </Toggle>
              ))}
            </ToggleGroup>
          }
        >
          {media.error ? (
            <ErrorState error={media.error} />
          ) : media.isLoading ? (
            <LoadingRows />
          ) : items.length === 0 ? (
            <EmptyState title={t("media.emptyTitle")} body={t("media.emptyBody")} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3" aria-label={t("media.library")}>
              {items.map((m) => (
                <li key={m.id}>
                  <MediaTile m={m} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
    </div>
  )
}
