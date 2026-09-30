"use client"

// The header bell (MH-360): the unread count as a gold badge, and a popover listing the inbox
// (the same /api/me/notifications the mobile app uses). A row opens what it is about and marks
// it read; "Mark all read" clears the badge. Live through the brain events stream.
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton, toast } from "@fadymondy/nasaq/web"
import {
  BellIcon,
  BellRingIcon,
  BrainCircuitIcon,
  CheckCheckIcon,
  DownloadIcon,
  PresentationIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { useTranslations } from "@/lib/i18n"
import {
  consoleHref,
  notificationsApi,
  useNotificationList,
  useUnreadNotifications,
  type AppNotification,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"

const KINDS: Record<string, { icon: LucideIcon; tone: string }> = {
  brain_access: { icon: BrainCircuitIcon, tone: "border-nq-accent/60 bg-nq-accent/10 text-nq-accent" },
  presentation_viewed: { icon: PresentationIcon, tone: "border-nq-action/60 bg-nq-action/10 text-nq-action" },
  presentation_downloaded: { icon: DownloadIcon, tone: "border-nq-action/60 bg-nq-action/10 text-nq-action" },
  test: { icon: BellRingIcon, tone: "border-nq-success/60 bg-nq-success/10 text-nq-success" },
}
const FALLBACK = { icon: BellIcon, tone: "border-border text-muted-foreground" }

export function NotificationBell() {
  const { t, locale, formatNumber } = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const unread = useUnreadNotifications()
  const list = useNotificationList(locale, open)
  const count = unread.data ?? 0
  const badge = count > 99 ? "99+" : count > 0 ? formatNumber(count) : null

  const pages = list.data
  const items = (pages ?? []).flatMap((p) => p.items ?? [])
  const hasMore = !!pages?.[pages.length - 1]?.nextCursor
  const listUnread = pages?.[0]?.unread

  // The realtime stream revalidates the count; while the list is open, it follows.
  const { mutate: mutateList } = list
  useEffect(() => {
    if (open && listUnread !== undefined && unread.data !== undefined && listUnread !== unread.data) void mutateList()
  }, [open, listUnread, unread.data, mutateList])

  const refresh = () => {
    void unread.mutate()
    void list.mutate()
  }

  const markRead = async (ids: string[] | "all") => {
    try {
      const res = await notificationsApi.markRead(ids === "all" ? { all: true } : { ids })
      void unread.mutate(res.unread, { revalidate: false })
      void list.mutate()
    } catch {
      toast.error(t("notifications.failed"))
      refresh()
    }
  }

  const openItem = (n: AppNotification) => {
    if (!n.readAt) void markRead([n.id])
    const href = consoleHref(n, locale)
    if (href) {
      setOpen(false)
      router.push(href)
    }
  }

  const remove = async (n: AppNotification) => {
    try {
      await notificationsApi.remove(n.id)
    } catch {
      toast.error(t("notifications.failed"))
    }
    refresh()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={badge ? t("notifications.bellUnread", { count: badge }) : t("notifications.bell")}
            title={t("notifications.bell")}
          />
        }
      >
        <BellIcon />
        {badge ? (
          <span
            aria-hidden
            className="absolute -end-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center bg-nq-accent px-1 font-font-mono text-[12px] leading-none text-[#0e1a3c]"
          >
            {badge}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1.5rem)] gap-0 rounded-none p-0">
        <div className="flex h-11 items-center justify-between gap-2 border-b border-border ps-3 pe-1.5">
          <p className="text-sm font-medium">{t("notifications.title")}</p>
          {count > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => void markRead("all")}>
              <CheckCheckIcon />
              {t("notifications.markAllRead")}
            </Button>
          ) : null}
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {list.error && !pages ? (
            <p className="p-4 text-sm text-nq-danger">{t("notifications.error")}</p>
          ) : !pages ? (
            <div className="space-y-3 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-8 rounded-none" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center border border-nq-accent/60 bg-nq-accent/10 text-nq-accent">
                <BellIcon className="size-4" />
              </span>
              <p className="text-sm font-medium">{t("notifications.empty")}</p>
              <p className="text-xs text-muted-foreground">{t("notifications.emptyHint")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <Row key={n.id} n={n} onOpen={openItem} onRemove={remove} />
              ))}
            </ul>
          )}
          {hasMore ? (
            <div className="border-t border-border p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={list.isValidating}
                onClick={() => void list.setSize(list.size + 1)}
              >
                {t("notifications.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({ n, onOpen, onRemove }: { n: AppNotification; onOpen: (n: AppNotification) => void; onRemove: (n: AppNotification) => void }) {
  const { t, timeAgo } = useTranslations()
  const kind = KINDS[n.kind] ?? FALLBACK
  const Icon = kind.icon
  const unread = !n.readAt
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn("flex w-full gap-3 px-3 py-2.5 text-start transition-colors hover:bg-nq-surface-soft", unread && "bg-nq-accent/5")}
      >
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center border", kind.tone)}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 pe-5">
          <span className={cn("line-clamp-2 text-sm", unread ? "font-medium text-foreground" : "text-nq-fg-body")} dir="auto">
            {unread ? <span className="sr-only">{t("notifications.unread")}: </span> : null}
            {n.title}
          </span>
          {n.body ? (
            <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" dir="auto">
              {n.body}
            </span>
          ) : null}
          <span className="mt-1 block font-font-mono text-[12px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
        </span>
        {unread ? <span aria-hidden className="absolute end-3 top-3.5 size-2 bg-nq-accent group-hover:hidden" /> : null}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute end-1.5 top-2 hidden group-focus-within:inline-flex group-hover:inline-flex"
        aria-label={t("notifications.delete")}
        title={t("notifications.delete")}
        onClick={() => onRemove(n)}
      >
        <XIcon />
      </Button>
    </li>
  )
}
