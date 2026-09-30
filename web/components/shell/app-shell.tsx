"use client"

// The console shell, on Nasaq's AppShell: a collapsible, resizable sidebar (a sheet below md),
// a sticky header and the page. Every signed-in area (brains, a brain's workspace, account,
// admin) renders through it with its own navigation. Collapse/resize state and Ctrl/Cmd+B are
// Nasaq's; this file owns the sign-in guard, realtime, the reading theme and the header actions.
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ComponentType, type MouseEvent, type ReactNode } from "react"
import { MessageSquarePlusIcon } from "lucide-react"
import {
  AppHeader,
  AppMain,
  AppShell as NasaqAppShell,
  Button,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  SidebarTrigger,
  Skeleton,
  useSidebarCollapsed,
} from "@fadymondy/nasaq/web"

import { CubeMark } from "@/components/brand/cube-mark"
import { ErrorState } from "@/components/states"
import { MahaamWidget, feedbackEnabled, openFeedback } from "@/components/feedback/mahaam-widget"
import { LiveIndicator } from "@/components/shell/live"
import { NotificationBell } from "@/components/shell/notification-bell"
import { Spotlight } from "@/components/spotlight/spotlight"
import { UserMenu } from "@/components/shell/user-menu"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { useTranslations } from "@/lib/i18n"
import { useNoteSettings } from "@/components/notes/note-settings-panel"
import { NoteThemeStyle } from "@/components/notes/theme-picker"
import { useRequireAuth } from "@/lib/use-require-auth"
import { RealtimeProvider } from "@/lib/realtime"
import { brandName } from "@/lib/brand-name"

export type NavItem = {
  /** Path after the locale, e.g. "/brains". */
  href: string
  /** Dictionary key. */
  label: string
  icon: ComponentType<{ className?: string }>
  /** Only an exact path match marks it active (an index route). */
  exact?: boolean
}
export type NavGroup = { label?: string; items: NavItem[] }

function Brand() {
  const { locale } = useTranslations()
  const collapsed = useSidebarCollapsed()
  return (
    <Link href={`/${locale}/brains`} className="flex h-8 items-center gap-2.5 px-1" aria-label={brandName(locale)}>
      <CubeMark mark={ZEKRA_MARK} size={24} />
      {collapsed ? null : <span className="text-label font-medium text-foreground">{brandName(locale)}</span>}
    </Link>
  )
}

/** A sidebar row. Nasaq's item is a plain anchor, so a plain left click routes client-side here. */
function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname()
  const router = useRouter()
  const { t, locale } = useTranslations()
  const href = `/${locale}${item.href}`
  const active = item.exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
  const Icon = item.icon
  const label = t(item.label)
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    router.push(href)
  }
  return (
    <SidebarItem href={href} active={active} icon={<Icon />} tooltip={label} onClick={onClick}>
      {label}
    </SidebarItem>
  )
}

function ShellSidebar({ groups }: { groups: NavGroup[] }) {
  const { t } = useTranslations()
  return (
    <Sidebar aria-label={t("shell.navigation")}>
      <SidebarHeader>
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g, i) => (
          <SidebarGroup key={g.label ?? i} label={g.label ? t(g.label) : undefined}>
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}

function ShellSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

/** Sidebar + sticky header + main, behind the sign-in guard. `start` fills the header's leading
 *  side (the brain switcher); `gate` can replace the body (e.g. a 403 for non-admins). */
export function AppShell({
  groups,
  start,
  brain,
  gate,
  children,
}: {
  groups: NavGroup[]
  start?: ReactNode
  /** The brain in scope, attached to problem reports. */
  brain?: string
  gate?: ReactNode
  children: ReactNode
}) {
  const me = useRequireAuth()
  const { t, locale } = useTranslations()

  let body: ReactNode
  if (me.error) body = <ErrorState error={me.error} />
  else if (!me.data) body = <ShellSkeleton />
  else body = gate ?? children

  return (
    <RealtimeProvider>
      {/* The reading theme repaints the whole app, so it is applied here rather
          than inside the note pane, otherwise it would only take effect on
          pages that happen to render a note. */}
      <AppThemeEffect />
      <NasaqAppShell sidebar={<ShellSidebar groups={groups} />} resizeLabel={t("shell.resizeSidebar")}>
        <AppHeader>
          <SidebarTrigger label={t("shell.toggleSidebar")} />
          <div className="flex min-w-0 flex-1 items-center gap-1">{start}</div>
          <div className="flex items-center gap-1">
            {me.data ? <Spotlight namespace={brain} /> : null}
            {me.data && feedbackEnabled ? (
              <Button
                variant="secondary"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => openFeedback()}
                aria-label={t("feedback.report")}
              >
                <MessageSquarePlusIcon />
                <span className="hidden sm:inline">{t("feedback.report")}</span>
              </Button>
            ) : null}
            <LiveIndicator />
            {me.data ? <NotificationBell /> : null}
            {me.data ? <UserMenu user={me.data} /> : null}
          </div>
        </AppHeader>
        <AppMain className="p-0">{body}</AppMain>
      </NasaqAppShell>

      {/* Mahaam Feedback: loaded only inside the signed-in app, never on public pages. */}
      {me.data ? <MahaamWidget locale={locale} /> : null}
    </RealtimeProvider>
  )
}

/** Applies the saved reading theme to the document, app-wide. */
function AppThemeEffect() {
  const { settings } = useNoteSettings()
  return <NoteThemeStyle id={settings.theme} />
}
