"use client"

import Link from "next/link"
import { Badge, Card } from "@fadymondy/nasaq/web"

import { MEDIA_ICONS, statusVariant } from "@/components/media/kind-icon"
import { useTranslations } from "@/lib/i18n"
import { clock, type Media } from "@/lib/media"

/** One gallery card: a preview (the image itself, or the kind's icon), name, kind and read status. */
export function MediaTile({ m }: { m: Media }) {
  const { t, timeAgo } = useTranslations()
  const Icon = MEDIA_ICONS[m.kind]
  return (
    <Card className="group overflow-hidden p-0 transition-shadow hover:shadow-md">
      <Link href={`/b/${encodeURIComponent(m.namespace)}/media/${m.id}`} className="flex flex-col">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-nq-hover">
          {m.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.url} alt={m.name} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : m.kind === "video" ? (
            <video src={`${m.url}#t=1`} preload="metadata" muted className="size-full object-cover" />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--nq-action)_14%,transparent)] text-nq-action">
              <Icon className="size-7" />
            </span>
          )}
          <Badge variant={statusVariant(m.status)} className="absolute end-2 top-2">
            {t(`media.status.${m.status}`)}
          </Badge>
        </div>
        <div className="flex flex-col gap-1 px-3 py-2.5">
          <span dir="auto" className="truncate text-sm font-medium text-foreground">
            {m.name}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5" /> {t(`media.kind.${m.kind}`)}
            {m.result?.duration ? <span dir="ltr">· {clock(m.result.duration)}</span> : null}
            <span className="ms-auto">{timeAgo(m.createdAt)}</span>
          </span>
        </div>
      </Link>
    </Card>
  )
}
