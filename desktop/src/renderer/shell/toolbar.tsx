import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Ellipsis, Menu as MenuIcon, PanelLeft, Search } from "lucide-react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { IconButton } from "../components/chrome";
import { ZekraMark } from "../components/zekra-mark";
import { bridge, type AppInfo, type WindowStateEvent } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { usePlatform } from "../lib/platform";
import { AccountButton } from "./account-menu";
import { useRunCommand } from "./commands";
import { useRouter } from "./router";
import { Slot } from "./slots";

/*
The window's title area, native per OS (lib/platform.ts, theme.css):

  macOS    the unified toolbar IS the title bar — ONE 52px row over the
           content pane (Notes, Mail, Linear): [▢ ‹ Title/subtitle ··· actions ⌕]
           The traffic lights sit in the sidebar header, or here when the
           sidebar is collapsed / the UI is Arabic (they never mirror).
  Windows  a 40px title bar across the whole window (<WindowsTitleBar>): back,
           pane toggle, app mark + name, search, the app menu behind "…", and
           room for the native caption buttons; then a command bar over the
           content with the page title and its actions.
  Linux    the WM draws the frame; the content gets a GTK-style header bar:
           centred title, actions at the end, the primary menu (☰).

Screens name themselves with <WindowTitle title subtitle> (also the OS window
title, so the Window menu / Mission Control / the taskbar list it) and add
actions with <ToolbarActions>; both portal into the bar while mounted.
*/

export const TOOLBAR_HEIGHT = 52;

export function useWindowState(): WindowStateEvent {
  const [state, setState] = useState<WindowStateEvent>({ focused: true, fullscreen: false, maximized: false });
  useEffect(() => bridge().onWindowState(setState), []);
  return state;
}

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void bridge().getAppInfo().then(setInfo);
  }, []);
  return info;
}

/** Where the OS window controls are and how much room they need (0 in full
 *  screen, where macOS hides the traffic lights). */
export function useWindowControls(): AppInfo["windowControls"] {
  const p = usePlatform();
  const win = useWindowState();
  if (p.platform === "darwin" && win.fullscreen) return { side: "left", inset: 0 };
  return p.windowControls;
}

/** Padding that keeps content clear of the window controls, on whichever
 *  physical side they sit (macOS lights go right in an Arabic launch). */
export function controlsPadding(c: AppInfo["windowControls"]): CSSProperties {
  if (!c.inset) return {};
  return c.side === "left" ? { paddingLeft: c.inset } : { paddingRight: c.inset };
}

/** True when the window controls sit on the layout's start edge (the
 *  sidebar's side): left in LTR, right in RTL. */
export function controlsAtStart(c: AppInfo["windowControls"], isRtl: boolean): boolean {
  return c.side === (isRtl ? "right" : "left");
}

/** @deprecated use useWindowControls — kept for existing callers. */
export function useTrafficLightInset(): number {
  const c = useWindowControls();
  return c.side === "left" ? c.inset : 0;
}

type Hosts = { title: HTMLElement | null; actions: HTMLElement | null };
const HostsContext = createContext<Hosts>({ title: null, actions: null });
const SetHostsContext = createContext<{ setTitle: (el: HTMLElement | null) => void; setActions: (el: HTMLElement | null) => void } | null>(null);

export function ToolbarProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const setters = useMemo(() => ({ setTitle, setActions }), []);
  const hosts = useMemo(() => ({ title, actions }), [title, actions]);
  return (
    <SetHostsContext.Provider value={setters}>
      <HostsContext.Provider value={hosts}>{children}</HostsContext.Provider>
    </SetHostsContext.Provider>
  );
}

/** Free-form content for the title area. Prefer <WindowTitle>. */
export function ToolbarTitle({ children }: { children: ReactNode }) {
  const { title } = useContext(HostsContext);
  return title ? createPortal(children, title) : null;
}

/** The screen's actions at the bar's end. */
export function ToolbarActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(HostsContext);
  return actions ? createPortal(children, actions) : null;
}

/** The window's title and subtitle (macOS unified toolbar style; the page
 *  title of Windows' command bar; the header-bar title on Linux). Also sets
 *  the OS window title. */
export function WindowTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  useEffect(() => {
    document.title = subtitle ? `${title} — ${subtitle}` : title;
  }, [title, subtitle]);
  return (
    <ToolbarTitle>
      <span className="window-title flex min-w-0 items-center gap-2">
        {icon ? <span className="flex shrink-0 [&_svg]:size-4">{icon}</span> : null}
        <span className="grid min-w-0 leading-tight">
          <span className="window-title-main truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
            {title}
          </span>
          {subtitle ? (
            <span className="window-title-sub truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
              {subtitle}
            </span>
          ) : null}
        </span>
      </span>
    </ToolbarTitle>
  );
}

/** Kept for screens that name themselves with a single heading. */
export function ToolbarHeading({ children }: { children: ReactNode; icon?: ReactNode }) {
  return <WindowTitle title={typeof children === "string" ? children : ""} />;
}

function popAppMenu(e: MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  void bridge().popupAppMenu?.(r.left, r.bottom + 2);
}

function SearchField({ className }: { className?: string }) {
  const { t } = useI18n();
  const run = useRunCommand();
  const { platform } = usePlatform();
  return (
    <button
      type="button"
      onClick={() => run("spotlight")}
      aria-label={t("shell.search")}
      className={cn(
        "field flex h-7 shrink-0 items-center gap-2 rounded-md ps-2 pe-1 text-start text-ui-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{t("tb.search")}</span>
      <KbdGroup className="gap-0.5">
        <Kbd className="h-5 min-w-5 bg-background/60 text-[12px]">{platform === "darwin" ? "⌘" : "Ctrl"}</Kbd>
        <Kbd className="h-5 min-w-5 bg-background/60 text-[12px]">K</Kbd>
      </KbdGroup>
    </button>
  );
}

/** The title bar's trailing items (Health Debug / native toolbars): the
 *  notification bell (its popover is the center, features/notify/bell.tsx)
 *  and the account avatar (a native menu; the account itself is in the
 *  Settings window). */
function TrailingItems() {
  return (
    <span className="ms-0.5 flex shrink-0 items-center gap-0.5">
      <Slot name="titlebar.bell" />
      <Slot name="titlebar.account" fallback={<AccountButton />} />
    </span>
  );
}

/** Windows only: the title bar spanning the whole window. */
export function WindowsTitleBar() {
  const { t } = useI18n();
  const { back, canGoBack } = useRouter();
  const { toggleSidebar } = useSidebar();
  const controls = useWindowControls();
  const win = useWindowState();
  return (
    <header
      className="win-titlebar app-drag app-chrome relative flex shrink-0 items-center gap-1 ps-1"
      style={{ height: "var(--titlebar-h)", paddingRight: controls.side === "right" ? controls.inset : undefined }}
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-0.5", !win.focused && "opacity-60")}>
        <IconButton label={t("tb.back")} onClick={back} disabled={!canGoBack} className="disabled:opacity-40">
          <ChevronLeft className="rtl:-scale-x-100" />
        </IconButton>
        <IconButton label={t("sb.toggle")} onClick={toggleSidebar}>
          <MenuIcon />
        </IconButton>
        <ZekraMark size={16} className="ms-2 shrink-0" />
        <span className="ms-1.5 truncate text-[13px]">{t("app.name")}</span>
        <div className="min-w-4 flex-1 self-stretch" />
        <SearchField className="w-[min(360px,36vw)]" />
        <div className="min-w-4 flex-1 self-stretch" />
        <TrailingItems />
        <IconButton label={t("sb.appMenu")} onClick={popAppMenu}>
          <Ellipsis />
        </IconButton>
      </div>
    </header>
  );
}

export function Toolbar({ sidebar = true, search = true }: { sidebar?: boolean; search?: boolean }) {
  const { t, isRtl } = useI18n();
  const { back, canGoBack } = useRouter();
  const { open, toggleSidebar } = useSidebar();
  const { platform } = usePlatform();
  const setters = useContext(SetHostsContext);
  const win = useWindowState();
  const controls = useWindowControls();

  if (platform === "win32") {
    // The command bar under the title bar: page title + actions.
    return (
      <header className="toolbar app-chrome flex shrink-0 items-center gap-1 px-4">
        <div ref={setters?.setTitle} className="flex min-w-0 items-center gap-2" />
        <div className="min-w-4 flex-1" />
        <div ref={setters?.setActions} className="flex shrink-0 items-center gap-1" />
        <Slot name="titlebar.end" />
      </header>
    );
  }

  if (platform === "linux") {
    // A GTK header bar: centred title, primary menu at the end.
    return (
      <header className="toolbar app-chrome relative flex shrink-0 items-center gap-1 px-2">
        {sidebar && !open ? (
          <IconButton label={t("sb.toggle")} onClick={toggleSidebar}>
            <PanelLeft className="rtl:-scale-x-100" />
          </IconButton>
        ) : null}
        <IconButton label={t("tb.back")} onClick={back} disabled={!canGoBack} className="disabled:opacity-40">
          <ChevronLeft className="rtl:-scale-x-100" />
        </IconButton>
        <div className="pointer-events-none absolute inset-x-40 flex justify-center">
          <div ref={setters?.setTitle} className="pointer-events-auto flex min-w-0 items-center justify-center gap-2 text-center" />
        </div>
        <div className="flex-1" />
        <div ref={setters?.setActions} className="flex shrink-0 items-center gap-1" />
        <Slot name="titlebar.end" />
        {search ? <SearchField className="w-44" /> : null}
        <TrailingItems />
        <IconButton label={t("sb.appMenu")} onClick={popAppMenu}>
          <MenuIcon />
        </IconButton>
      </header>
    );
  }

  // macOS: the unified toolbar. The lights live in the sidebar when it is open
  // on their side; otherwise the toolbar keeps clear of them.
  const lightsHere = controls.inset > 0 && (!controlsAtStart(controls, isRtl) || !open || !sidebar);
  return (
    <header
      className="toolbar app-drag app-chrome relative flex shrink-0 items-center gap-1 px-2.5"
      data-blurred={!win.focused}
      style={lightsHere ? controlsPadding(controls) : undefined}
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-1 transition-opacity", !win.focused && "opacity-60")}>
        {sidebar && !open ? (
          <IconButton label={t("sb.toggle")} shortcut="⌥⌘S" onClick={toggleSidebar}>
            <PanelLeft className="rtl:-scale-x-100" />
          </IconButton>
        ) : null}
        <IconButton label={t("tb.back")} shortcut="⌘[" onClick={back} disabled={!canGoBack} className="disabled:opacity-30">
          <ChevronLeft className="rtl:-scale-x-100" />
        </IconButton>
        <div ref={setters?.setTitle} className="ms-1 flex min-w-0 items-center gap-2" />
        <div className="min-w-4 flex-1 self-stretch" />
        <div ref={setters?.setActions} className="flex shrink-0 items-center gap-1" />
        <Slot name="titlebar.end" />
        {search ? <SearchField className="ms-1 w-44 lg:w-56" /> : null}
        <TrailingItems />
      </div>
    </header>
  );
}
