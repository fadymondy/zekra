import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  Archive,
  ChevronRight,
  Clock,
  KeyRound,
  NotebookText,
  PanelLeft,
  Pin,
  Plus,
  Presentation,
  Settings as SettingsIcon,
  WifiOff,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { BrainAvatar } from "../components/brain-avatar";
import { IconButton, PaneResizer } from "../components/chrome";
import { exportBrain } from "../features/brains/brains-data";
import { useI18n, type TKey } from "../lib/i18n";
import { SEP, showMenu } from "../lib/native-menu";
import { usePlatform } from "../lib/platform";
import { useRunCommand } from "./commands";
import { useRouter, type BrainList, type BrainTab } from "./router";
import { useSession } from "./session";
import { Slot } from "./slots";
import { toast } from "./toast";
import { useWindowControls } from "./toolbar";
import { bridge } from "../lib/bridge";

/*
The source list (shadcn Sidebar primitives, web/components/ui/sidebar.tsx),
in the shape every native notes/mail app uses — Notes, Mail, Finder on macOS;
the navigation pane of Settings / Explorer on Windows; a libadwaita sidebar
on Linux. It sits on the START side (right in Arabic).

  ▾ <open brain>        its library: All Notes · Pinned · Recent · Archived ·
                        Presentations · Vault
  ▾ Brains          +   every brain; right-click for its native menu. The
                        header itself opens the all-brains table (there is
                        no separate "All brains" row).
  ─────────────────
  <sidebar.status>  ⚙   sync / offline / updates · Settings (its own window)

Notifications are the title bar bell's popover and the account is in the
toolbar / the Settings window (Health Debug's layout) — neither is a row here.

Section headers are disclosure groups (state persisted). Row height, font,
selection style and the header row are per-OS tokens in theme.css
(--nav-row-h, .nav-row[data-active]…), so this file has no platform forks
beyond where the traffic lights and the pane toggle go.
*/

export const SIDEBAR_WIDTH = { min: 200, max: 360, initial: 240 };
const OPEN_KEY = "zekra.desktop.sidebar-sections";

function useSections(): [Record<string, boolean>, (k: string) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const toggle = (k: string) =>
    setOpen((o) => {
      const next = { ...o, [k]: o[k] === false };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  return [open, toggle];
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** One source-list row. */
function NavRow({ icon, label, active, onClick, onContextMenu, badge, title }: {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  badge?: ReactNode;
  title?: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={onClick} onContextMenu={onContextMenu} title={title} className="nav-row">
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </SidebarMenuButton>
      {badge ? <SidebarMenuBadge className="nav-badge">{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}

/** A disclosure section header (Finder / Notes: the chevron shows on hover). */
function Section({ id, label, open, onToggle, action, children, onOpen, active, openLabel }: {
  id: string;
  label: ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  action?: ReactNode;
  children: ReactNode;
  /** The header is a link too (Brains -> the all-brains table); the chevron
   *  then toggles on its own. */
  onOpen?: () => void;
  active?: boolean;
  openLabel?: string;
}) {
  const chevron = (
    <ChevronRight
      aria-hidden
      className={cn(
        "size-3 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover/section:opacity-100 rtl:-scale-x-100",
        open && "rotate-90 rtl:-rotate-90",
      )}
    />
  );
  return (
    <SidebarGroup className="nav-section group/section px-2 pt-3 pb-0">
      <div className="nav-section-header flex items-center gap-0.5 pe-1">
        {onOpen ? (
          <>
            <button
              type="button"
              onClick={onOpen}
              aria-current={active ? "page" : undefined}
              title={openLabel}
              data-active={active || undefined}
              className="nav-section-link min-w-0 truncate rounded-md px-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {label}
            </button>
            <button
              type="button"
              aria-expanded={open}
              aria-label={typeof label === "string" ? label : undefined}
              onClick={() => onToggle(id)}
              className="flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {chevron}
            </button>
            <div className="flex-1" />
          </>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(id)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="min-w-0 truncate">{label}</span>
            {chevron}
          </button>
        )}
        {action}
      </div>
      {open ? (
        <SidebarGroupContent>
          <SidebarMenu className="gap-px">{children}</SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}

const LIBRARY: { list: BrainList; label: TKey; icon: typeof NotebookText }[] = [
  { list: "all", label: "sb.allNotes", icon: NotebookText },
  { list: "pinned", label: "sb.pinned", icon: Pin },
  { list: "recent", label: "sb.recentNotes", icon: Clock },
  { list: "archived", label: "sb.archived", icon: Archive },
];
const VIEWS: { tab: Exclude<BrainTab, "notes">; label: TKey; icon: typeof NotebookText }[] = [
  { tab: "presentations", label: "sb.presentations", icon: Presentation },
  { tab: "vault", label: "sb.vault", icon: KeyRound },
];

export function AppSidebar({ width, onWidth, onWidthDone }: {
  width: number;
  onWidth: (w: number) => void;
  onWidthDone: (w: number) => void;
}) {
  const { t, isRtl } = useI18n();
  const { route, navigate } = useRouter();
  const { brains, token, settings } = useSession();
  const run = useRunCommand();
  const { toggleSidebar } = useSidebar();
  const { platform } = usePlatform();
  const controls = useWindowControls();
  const online = useOnline();
  const [sections, toggleSection] = useSections();

  const openNs = route.name === "brain" ? route.ns : settings.activeBrain;
  const openBrain = brains?.find((b) => b.namespace === openNs) ?? null;
  const list: BrainList = route.name === "brain" && route.tab === "notes" ? (route.list ?? "all") : "all";
  const at = (tab: BrainTab) => route.name === "brain" && route.ns === openNs && route.tab === tab;

  function brainMenu(ns: string, e: MouseEvent) {
    e.preventDefault();
    void showMenu(
      [
        { id: "notes", label: t("sb.notes") },
        { id: "presentations", label: t("sb.presentations") },
        { id: "vault", label: t("sb.vault") },
        SEP,
        { id: "export", label: t("brains.menu.export") },
        SEP,
        { id: "new", label: `${t("sb.newBrain")}…` },
      ],
      e,
    ).then((id) => {
      if (id === "notes" || id === "presentations" || id === "vault") navigate({ name: "brain", ns, tab: id });
      else if (id === "new") run("new-brain");
      else if (id === "export" && token) {
        void exportBrain(token, ns)
          .then((path) => path && toast.success(t("brainsx.exported", { name: path.split(/[\\/]/).pop() ?? path })))
          .catch(() => toast.error(t("brains.export.failed")));
      }
    });
  }

  // macOS: the traffic lights live in this header (LTR: physical left edge).
  const lights = platform === "darwin" && controls.side === "left" && !isRtl ? controls.inset : 0;

  return (
    <Sidebar side="left" collapsible="offcanvas" className="app-chrome" aria-label={t("sb.label")}>
      <SidebarHeader
        className="nav-header app-drag flex-row items-center gap-1 p-0 ps-3 pe-2"
        style={lights ? { paddingLeft: lights } : undefined}
      >
        {platform === "linux" ? <span className="min-w-0 flex-1 truncate text-ui font-bold">{t("app.name")}</span> : <div className="flex-1" />}
        {platform !== "win32" ? (
          <IconButton label={t("sb.toggle")} shortcut={platform === "darwin" ? "⌥⌘S" : "Ctrl+Alt+S"} onClick={toggleSidebar}>
            <PanelLeft className="rtl:-scale-x-100" />
          </IconButton>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-2">
        {openBrain ? (
          <Section
            id="library"
            open={sections.library !== false}
            onToggle={toggleSection}
            label={<span dir="auto" className="block truncate" style={{ unicodeBidi: "plaintext" }}>{openBrain.displayName || openBrain.namespace}</span>}
          >
            {LIBRARY.map((it) => {
              const Icon = it.icon;
              return (
                <NavRow
                  key={it.list}
                  icon={<Icon />}
                  label={t(it.label)}
                  active={at("notes") && list === it.list}
                  onClick={() =>
                    navigate({ name: "brain", ns: openBrain.namespace, tab: "notes", ...(it.list === "all" ? {} : { list: it.list }) })
                  }
                />
              );
            })}
            {VIEWS.map((it) => {
              const Icon = it.icon;
              return (
                <NavRow
                  key={it.tab}
                  icon={<Icon />}
                  label={t(it.label)}
                  active={at(it.tab)}
                  onClick={() => navigate({ name: "brain", ns: openBrain.namespace, tab: it.tab })}
                />
              );
            })}
          </Section>
        ) : null}

        <Section
          id="brains"
          open={sections.brains !== false}
          onToggle={toggleSection}
          label={t("sb.brains")}
          onOpen={() => navigate({ name: "brains" })}
          active={route.name === "brains"}
          openLabel={t("win.sb.showAll")}
          action={
            <IconButton size="icon-xs" label={t("sb.newBrain")} onClick={() => run("new-brain")} className="nav-section-action">
              <Plus />
            </IconButton>
          }
        >
          {brains === null
            ? Array.from({ length: 4 }, (_, i) => (
                <SidebarMenuItem key={i}>
                  <div className="nav-row flex items-center gap-2 px-2">
                    <span className="size-4 animate-pulse rounded bg-sidebar-accent" />
                    <span className="h-2.5 flex-1 animate-pulse rounded bg-sidebar-accent" style={{ maxWidth: `${50 + i * 12}%` }} />
                  </div>
                </SidebarMenuItem>
              ))
            : brains.map((b) => (
                <NavRow
                  key={b.namespace}
                  icon={<BrainAvatar brain={b} token={token} size={16} />}
                  label={<span dir="auto" className="block truncate" style={{ unicodeBidi: "plaintext" }}>{b.displayName || b.namespace}</span>}
                  title={b.displayName || b.namespace}
                  onClick={() => navigate({ name: "brain", ns: b.namespace, tab: "notes" })}
                  onContextMenu={(e) => brainMenu(b.namespace, e)}
                />
              ))}
        </Section>
      </SidebarContent>

      <SidebarFooter className="flex-row items-end gap-1 px-2 pt-1 pb-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {!online ? (
            <div className="flex items-center gap-2 px-2 py-1 text-ui-sm text-muted-foreground">
              <WifiOff className="size-3.5 stroke-[1.75]" />
              {t("shell.offline")}
            </div>
          ) : null}
          <Slot name="sidebar.status" />
        </div>
        <IconButton
          label={t("sb.settings")}
          shortcut={platform === "darwin" ? "⌘," : "Ctrl+,"}
          side="top"
          onClick={() => void bridge().openSettingsWindow?.("general")}
        >
          <SettingsIcon />
        </IconButton>
      </SidebarFooter>

      <PaneResizer
        label={t("sb.resize")}
        width={width}
        min={SIDEBAR_WIDTH.min}
        max={SIDEBAR_WIDTH.max}
        reset={SIDEBAR_WIDTH.initial}
        onWidth={onWidth}
        onDone={onWidthDone}
      />
    </Sidebar>
  );
}
