"use client"

// The header's notification center (MH-360) on Nasaq's NotificationCenter, as a side-over sheet:
// the unread count on the bell, All / Unread tabs and "Mark all read". The inbox is the same
// /api/me/notifications the mobile app uses. A row opens what it is about and marks it read; its
// context menu (right-click, Shift+F10) opens, marks read or deletes. Live through the events stream.
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { NotificationCenter, toast, type ContextMenuAction, type NotificationCenterItem } from "@fadymondy/nasaq/web"
import {
  BellIcon,
  BellRingIcon,
  BrainCircuitIcon,
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PresentationIcon,
  TrashIcon,
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

const KINDS: Record<string, LucideIcon> = {
  brain_access: BrainCircuitIcon,
  presentation_viewed: PresentationIcon,
  presentation_downloaded: DownloadIcon,
  test: BellRingIcon,
}

export function NotificationBell() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const unread = useUnreadNotifications()
  const list = useNotificationList(locale, open)

  const pages = list.data
  const all = (pages ?? []).flatMap((p) => p.items ?? [])
  const byId = new Map(all.map((n) => [n.id, n]))
  const listUnread = pages?.[0]?.unread

  // The realtime stream revalidates the count; while the sheet is open, the list follows.
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

  const items: NotificationCenterItem[] = all.map((n) => {
    const Icon = KINDS[n.kind] ?? BellIcon
    return { id: n.id, title: n.title, description: n.body || undefined, icon: <Icon />, time: n.createdAt, unread: !n.readAt }
  })

  const actions = (item: NotificationCenterItem): ContextMenuAction[] => {
    const n = byId.get(item.id)
    if (!n) return []
    return [
      ...(consoleHref(n, locale) ? [{ id: "open", label: t("notifications.open"), icon: ExternalLinkIcon, onSelect: () => openItem(n) }] : []),
      { id: "read", label: t("notifications.markRead"), icon: CheckIcon, disabled: !!n.readAt, onSelect: () => void markRead([n.id]) },
      { id: "delete", label: t("notifications.delete"), icon: TrashIcon, danger: true, group: "danger", onSelect: () => void remove(n) },
    ]
  }

  return (
    <NotificationCenter
      variant="sheet"
      items={items}
      unreadCount={unread.data ?? 0}
      open={open}
      onOpenChange={setOpen}
      onItemClick={(item) => {
        const n = byId.get(item.id)
        if (n) openItem(n)
      }}
      onMarkAllRead={() => void markRead("all")}
      itemActions={actions}
      labels={{
        title: t("notifications.title"),
        markAllRead: t("notifications.markAllRead"),
        emptyAll: t("notifications.empty"),
        emptyAllDescription: t("notifications.emptyHint"),
        trigger: (count: number) => (count ? t("notifications.bellUnread", { count }) : t("notifications.bell")),
      }}
    />
  )
}
