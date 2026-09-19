// The console's one app shell, drawn exactly like Managy's workspace shell: the grid's
// `grid-shell` (a 15rem card-ground sidebar split from main by one hairline), a sticky
// h-14 header, flat nav rows marked by a start-edge rule, and a slide-out sheet below md.
// Every layout (hub, brain workspace, admin) renders through it with its own nav + switcher.
import { useState, type ComponentType, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { LanguagesIcon, MenuIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
  Sheet, SheetContent, SheetTitle,
  useLanguage, useTheme,
} from "@togo-framework/ui";
import { CubeMark } from "./brand";
import { UserMenu } from "./chrome";
import { LiveIndicator } from "../lib/realtime";

export type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Only an exact path match marks it active (an index route). */
  exact?: boolean;
};
export type NavGroup = { label?: string; items: NavItem[] };

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <CubeMark size={24} />
      <span className="text-[15px] font-medium">Zekra</span>
    </Link>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={
        "flex items-center gap-2.5 border-s-2 px-3 py-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0 " +
        (active
          ? "border-grid-action bg-grid-soft font-medium text-grid-fg"
          : "border-transparent text-grid-body hover:bg-grid-soft hover:text-grid-fg")
      }
    >
      <Icon />
      {item.label}
    </Link>
  );
}

function ShellNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col py-3" aria-label="Navigation">
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col">
          {g.label ? (
            <p className={"grid-micro px-4 pb-1 " + (i > 0 ? "mt-4 border-t border-line pt-4" : "pt-1")}>{g.label}</p>
          ) : null}
          {g.items.map((item) => (
            <NavLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </Button>
  );
}

const LANGS = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
] as const;

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Language" title="Language">
          <LanguagesIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>Language</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={language} onValueChange={(v) => setLanguage(v as "en" | "ar")}>
          {LANGS.map((l) => (
            <DropdownMenuRadioItem key={l.id} value={l.id} lang={l.id}>
              {l.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sidebar + sticky header + main. `start` fills the header's leading side (the brain switcher). */
export function AppShell({ groups, start, children }: { groups: NavGroup[]; start?: ReactNode; children?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { isRTL } = useLanguage();

  return (
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
              size="icon"
              className="h-8 w-8 md:hidden"
              aria-label="Navigation"
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon className="h-4 w-4" />
            </Button>
            {start}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LiveIndicator />
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1">{children ?? <Outlet />}</main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side={isRTL ? "right" : "left"} className="w-72 gap-0 p-0">
          <SheetTitle className="flex h-14 items-center border-b border-line px-4">
            <Brand />
          </SheetTitle>
          <ShellNav groups={groups} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
