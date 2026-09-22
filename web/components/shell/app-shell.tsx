"use client"

// The console shell, drawn like Managy's workspace shell on the grid design system: a 15rem
// card-ground sidebar (`grid-shell`), flat nav rows marked by a start-edge rule with group
// labels, a sticky h-14 header, and a slide-out sheet below md. Every signed-in area (brains,
// a brain's workspace, account, admin) renders through it with its own navigation.
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react"
import { MenuIcon, MessageSquarePlusIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { CubeMark } from "@/components/brand/cube-mark"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { ErrorState } from "@/components/states"
import { MahaamWidget, feedbackEnabled, openFeedback } from "@/components/feedback/mahaam-widget"
import { LiveIndicator } from "@/components/shell/live"
import { Spotlight } from "@/components/spotlight/spotlight"
import { UserMenu } from "@/components/shell/user-menu"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { useTranslations } from "@/lib/i18n"
import { useNoteSettings } from "@/components/notes/note-settings-panel"
import { NoteThemeStyle } from "@/components/notes/theme-picker"
import { useRequireAuth } from "@/lib/use-require-auth"
import { RealtimeProvider } from "@/lib/realtime"
import { cn } from "@/lib/utils"
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

function Brand({ compact = false }: { compact?: boolean }) {
  const { locale } = useTranslations()
  return (
    <Link href={`/${locale}/brains`} className="flex items-center gap-2.5" aria-label={brandName(locale)}>
      <CubeMark mark={ZEKRA_MARK} size={24} />
      {compact ? null : <span className="text-[15px] font-medium">{brandName(locale)}</span>}
    </Link>
  )
}

/** Desktop sidebar: full (15rem) or collapsed to an icon rail. Remembered per browser. */
const SIDEBAR_KEY = "zekra.sidebar"
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "collapsed")
    } catch {}
  }, [])
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "open" : "collapsed")
      } catch {}
      return !c
    })
  }, [])
  // Ctrl/⌘+B toggles it, as in most editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])
  return { collapsed, toggle }
}

function NavLink({ item, onNavigate, compact = false }: { item: NavItem; onNavigate?: () => void; compact?: boolean }) {
  const pathname = usePathname()
  const { t, locale } = useTranslations()
  const href = `/${locale}${item.href}`
  const active = item.exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
  const Icon = item.icon
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? t(item.label) : undefined}
      title={compact ? t(item.label) : undefined}
      className={cn(
        "flex items-center gap-2.5 border-s-2 py-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        compact ? "justify-center px-0" : "px-3",
        active
          ? "border-grid-action bg-grid-soft font-medium text-grid-fg"
          : "border-transparent text-grid-body hover:bg-grid-soft hover:text-grid-fg",
      )}
    >
      <Icon />
      {compact ? null : t(item.label)}
    </Link>
  )
}

function ShellNav({ groups, onNavigate, compact = false }: { groups: NavGroup[]; onNavigate?: () => void; compact?: boolean }) {
  const { t } = useTranslations()
  return (
    <nav className="flex flex-col py-3" aria-label={t("shell.navigation")}>
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col">
          {g.label ? (
            compact ? (
              i > 0 ? <div className="mx-3 my-3 border-t border-line" aria-hidden /> : null
            ) : (
              <p className={cn("grid-micro px-4 pb-1", i > 0 ? "mt-4 border-t border-line pt-4" : "pt-1")}>{t(g.label)}</p>
            )
          ) : null}
          {g.items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} compact={compact} />
          ))}
        </div>
      ))}
    </nav>
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
  const { t, isRtl, locale } = useTranslations()
  const [navOpen, setNavOpen] = useState(false)
  const sidebar = useSidebarCollapsed()

  let body: ReactNode
  if (me.error) body = <ErrorState error={me.error} />
  else if (!me.data) body = <ShellSkeleton />
  else body = gate ?? children

  return (
    <RealtimeProvider>
    {/* The reading theme repaints the whole app, so it is applied here rather
        than inside the note pane — otherwise it would only take effect on
        pages that happen to render a note. */}
    <AppThemeEffect />
    <div className="grid-shell" data-collapsed={sidebar.collapsed ? "true" : undefined}>
      <aside className="grid-shell-nav sticky top-0 hidden h-dvh flex-col overflow-y-auto md:flex">
        <div className={cn("flex h-14 shrink-0 items-center border-b border-line", sidebar.collapsed ? "justify-center px-0" : "px-4")}>
          <Brand compact={sidebar.collapsed} />
        </div>
        <ShellNav groups={groups} compact={sidebar.collapsed} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-background px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label={t("shell.navigation")}
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              aria-label={sidebar.collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
              title={`${sidebar.collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")} (Ctrl+B)`}
              aria-pressed={sidebar.collapsed}
              onClick={sidebar.toggle}
            >
              {sidebar.collapsed ? <PanelLeftOpenIcon className="rtl:-scale-x-100" /> : <PanelLeftCloseIcon className="rtl:-scale-x-100" />}
            </Button>
            {start}
          </div>
          <div className="flex items-center gap-1">
            {me.data ? <Spotlight namespace={brain} /> : null}
            {me.data && feedbackEnabled ? (
              <Button
                variant="outline"
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
            <LanguageSwitcher />
            <ThemeToggle />
            {me.data ? <UserMenu user={me.data} /> : null}
          </div>
        </header>
        <main className="min-w-0 flex-1">{body}</main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side={isRtl ? "right" : "left"} className="w-72 gap-0 p-0">
          <SheetTitle className="flex h-14 items-center border-b border-line px-4">
            <Brand />
          </SheetTitle>
          <ShellNav groups={groups} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Mahaam Feedback: loaded only inside the signed-in app, never on public pages. */}
      {me.data ? <MahaamWidget locale={locale} /> : null}
    </div>
    </RealtimeProvider>
  )
}


/** Applies the saved reading theme to the document, app-wide. */
function AppThemeEffect() {
  const { settings } = useNoteSettings()
  return <NoteThemeStyle id={settings.theme} />
}
