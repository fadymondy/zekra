"use client"

// The console shell, drawn like Managy's workspace shell on the grid design system: a 15rem
// card-ground sidebar (`grid-shell`), flat nav rows marked by a start-edge rule with group
// labels, a sticky h-14 header, and a slide-out sheet below md. Every signed-in area (brains,
// a brain's workspace, account, admin) renders through it with its own navigation.
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, type ComponentType, type ReactNode } from "react"
import { MenuIcon, MessageSquarePlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { CubeMark } from "@/components/brand/cube-mark"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { ErrorState } from "@/components/states"
import { ReportProblemDialog, feedbackEnabled } from "@/components/feedback/report-problem"
import { LiveIndicator } from "@/components/shell/live"
import { UserMenu } from "@/components/shell/user-menu"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { useTranslations } from "@/lib/i18n"
import { useRequireAuth } from "@/lib/use-require-auth"
import { RealtimeProvider } from "@/lib/realtime"
import { cn } from "@/lib/utils"

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
  return (
    <Link href={`/${locale}/brains`} className="flex items-center gap-2.5">
      <CubeMark mark={ZEKRA_MARK} size={24} />
      <span className="text-[15px] font-medium">Zekra</span>
    </Link>
  )
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
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
      className={cn(
        "flex items-center gap-2.5 border-s-2 px-3 py-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        active
          ? "border-grid-action bg-grid-soft font-medium text-grid-fg"
          : "border-transparent text-grid-body hover:bg-grid-soft hover:text-grid-fg",
      )}
    >
      <Icon />
      {t(item.label)}
    </Link>
  )
}

function ShellNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const { t } = useTranslations()
  return (
    <nav className="flex flex-col py-3" aria-label={t("shell.navigation")}>
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col">
          {g.label ? (
            <p className={cn("grid-micro px-4 pb-1", i > 0 ? "mt-4 border-t border-line pt-4" : "pt-1")}>{t(g.label)}</p>
          ) : null}
          {g.items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
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
  const { t, isRtl } = useTranslations()
  const [navOpen, setNavOpen] = useState(false)
  const [reporting, setReporting] = useState(false)

  let body: ReactNode
  if (me.error) body = <ErrorState error={me.error} />
  else if (!me.data) body = <ShellSkeleton />
  else body = gate ?? children

  return (
    <RealtimeProvider>
    <div className="grid-shell">
      <aside className="grid-shell-nav sticky top-0 hidden h-dvh flex-col overflow-y-auto md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <Brand />
        </div>
        <ShellNav groups={groups} />
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
            {start}
          </div>
          <div className="flex items-center gap-1">
            {me.data && feedbackEnabled ? (
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setReporting(true)}
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

      {feedbackEnabled ? <ReportProblemDialog open={reporting} onOpenChange={setReporting} brain={brain} /> : null}
    </div>
    </RealtimeProvider>
  )
}
