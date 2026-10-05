"use client"

// The console shell, on Nasaq's AppShell: a collapsible, resizable sidebar (a sheet below md),
// a sticky header and the page. Every signed-in area (brains, a brain's workspace, account,
// admin) renders through it with its own navigation. Collapse/resize state and Ctrl/Cmd+B are
// Nasaq's; this file owns the sign-in guard, realtime and the reading theme. Layout follows Nasaq's
// App Shell dashboard: the sidebar carries the brand, the brain (tenant) switcher, search (the
// command palette) and the user menu; the header carries only the notification center.
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ComponentType, type MouseEvent, type ReactNode, useEffect, useState } from "react"
import {
  AppHeader,
  AppMain,
  AppShell as NasaqAppShell,
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
import { MahaamWidget } from "@/components/feedback/mahaam-widget"
import { BrainSwitcher } from "@/components/shell/brain-switcher"
import { NotificationBell } from "@/components/shell/notification-bell"
import { Spotlight, SpotlightTrigger } from "@/components/spotlight/spotlight"
import { UserMenu } from "@/components/shell/user-menu"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { useTranslations } from "@/lib/i18n"
import { useNoteSettings } from "@/components/notes/note-settings-panel"
import { NoteThemeStyle } from "@/components/notes/theme-picker"
import { useRequireAuth } from "@/lib/use-require-auth"
import { RealtimeProvider } from "@/lib/realtime"
import { brandName } from "@/lib/brand-name"
import { homeHref } from "@/lib/last-brain"
import type { User } from "@/lib/queries"

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
  // Read after mount: the last brain lives in localStorage, which the server render cannot see.
  const [home, setHome] = useState(`/${locale}/brains`)
  useEffect(() => setHome(homeHref(locale)), [locale])
  return (
    <Link href={home} className="flex h-8 items-center gap-2.5 px-1" aria-label={brandName(locale)}>
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

function ShellSidebar({ groups, brain, user }: { groups: NavGroup[]; brain?: string; user?: User }) {
  const { t } = useTranslations()
  return (
    <Sidebar aria-label={t("shell.navigation")}>
      <SidebarHeader>
        <Brand />
        {user ? <BrainSwitcher namespace={brain} /> : null}
        {user ? <SpotlightTrigger /> : null}
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
      <SidebarFooter>{user ? <UserMenu user={user} /> : null}</SidebarFooter>
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

/** Sidebar + sticky header + main, behind the sign-in guard. `brain` is the brain in scope (the
 *  switcher's value and the search scope); `gate` can replace the body (e.g. a 403 for non-admins). */
export function AppShell({
  groups,
  brain,
  gate,
  children,
}: {
  groups: NavGroup[]
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
      <NasaqAppShell sidebar={<ShellSidebar groups={groups} brain={brain} user={me.data ?? undefined} />} resizeLabel={t("shell.resizeSidebar")}>
        <AppHeader>
          <SidebarTrigger label={t("shell.toggleSidebar")} />
          <div className="ms-auto flex items-center gap-1">{me.data ? <NotificationBell /> : null}</div>
        </AppHeader>
        <AppMain className="p-0">{body}</AppMain>
        {me.data ? <Spotlight namespace={brain} /> : null}
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
