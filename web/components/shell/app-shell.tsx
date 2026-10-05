"use client"

// The console shell, on Nasaq's AppShell: a collapsible, resizable sidebar (a sheet below md),
// a sticky header and the page. Every signed-in area (brains, a brain's workspace, account,
// admin) renders through it with its own navigation. Collapse/resize state and Ctrl/Cmd+B are
// Nasaq's; this file owns the sign-in guard, realtime and the reading theme. Layout follows Nasaq's
// App Shell dashboard: the sidebar carries the brand, the brain (tenant) switcher, search (the
// command palette) and the user menu; the header carries only the notification center.
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, type ComponentType, type MouseEvent, type ReactNode } from "react"
import {
  AppHeader,
  AppMain,
  AppShell as NasaqAppShell,
  BootSplash,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  SidebarTrigger,
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
import { getLastBrain, homeHref } from "@/lib/last-brain"
import { brainNav } from "@/lib/nav"
import { useBrains, type User } from "@/lib/queries"

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
  const router = useRouter()
  // The href stays the server-renderable /brains; a plain click goes to the last used brain
  // (localStorage), so server and client markup always match.
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    router.push(homeHref(locale))
  }
  return (
    <Link href={`/${locale}/brains`} onClick={onClick} className="flex h-8 items-center gap-2.5 px-1" aria-label={brandName(locale)}>
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

/** Shown until the session resolves, so a half-built shell (no switcher, no user menu) never flashes. */
function ShellSplash() {
  const { locale } = useTranslations()
  return <BootSplash className="h-dvh" mark={<CubeMark mark={ZEKRA_MARK} size={40} />} name={brandName(locale)} />
}

/** Sidebar + sticky header + main, behind the sign-in guard. `brain` is the brain in scope (the
 *  switcher's value and the search scope); outside a brain the last active one (else the first) stands
 *  in, and without `groups` its menu is the sidebar. `gate` can replace the body (e.g. a 403). */
export function AppShell({
  groups,
  brain,
  gate,
  children,
}: {
  groups?: NavGroup[]
  brain?: string
  gate?: ReactNode
  children: ReactNode
}) {
  const me = useRequireAuth()
  const { t, locale } = useTranslations()
  const brains = useBrains()

  // The server never has the session, but the client may already hold it in the SWR cache; until
  // mounted both render the splash so hydration always matches.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted || (!me.data && !me.error)) return <ShellSplash />

  const list = brains.data ?? []
  const last = getLastBrain()
  const scope = brain ?? (last && list.some((b) => b.namespace === last) ? last : list[0]?.namespace)
  const nav = groups ?? (scope ? brainNav(scope) : [])
  const body: ReactNode = me.error ? <ErrorState error={me.error} /> : (gate ?? children)

  return (
    <RealtimeProvider>
      {/* The reading theme repaints the whole app, so it is applied here rather
          than inside the note pane, otherwise it would only take effect on
          pages that happen to render a note. */}
      <AppThemeEffect />
      {/* Viewport-bound on desktop: the page never scrolls, so the sidebar keeps its own scroll and
          the user menu stays in view while the main panel scrolls inside. */}
      <NasaqAppShell className="md:h-dvh md:overflow-hidden" sidebar={<ShellSidebar groups={nav} brain={scope} user={me.data ?? undefined} />} resizeLabel={t("shell.resizeSidebar")}>
        <AppHeader>
          <SidebarTrigger label={t("shell.toggleSidebar")} />
          <div className="ms-auto flex items-center gap-1">{me.data ? <NotificationBell /> : null}</div>
        </AppHeader>
        <AppMain className="p-0 md:min-h-0 md:overflow-y-auto">{body}</AppMain>
        {me.data ? <Spotlight namespace={scope} /> : null}
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
