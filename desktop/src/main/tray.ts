// Menubar (tray) item: the monochrome Zekra mark as a template image, so macOS
// tints it for light/dark menubars. Everything the app does is reachable from
// here, as the app's own windows (app-windows.ts, native-ui.ts):
//
//   Open Zekra
//   ───────────────
//   New Note                      a note window with the brain picker
//   New Brain…                    the New Brain window
//   Search…                       the Spotlight panel
//   Quick Capture                 the capture panel (its global shortcut)
//   ───────────────
//   Notifications (2 unread)      the main window's bell popover
//   Recent Notes ▸                last 8 opened -> note windows
//   Brains ▸                      every brain -> the main window at it
//   ───────────────
//   ● Synced 2 min ago            live sync status (services.ts)
//   Sync Now
//   ───────────────
//   ● MCP: …                      status line; the installers are the Settings
//   Install for Claude Code…      ▸ Connect ones (mcp-install.ts), confirm +
//   Install for Cursor…           backup
//   ───────────────
//   Settings…                     the Settings window
//   Check for Updates…            relabels itself: Downloading… / Restart to Update
//   About Zekra
//   ───────────────
//   Quit Zekra
//
// Anything that needs the main window's renderer (Notifications, a brain) goes
// through the READY queue (renderer-events.ts): with the window closed, the
// click creates it and the command lands once it has loaded. The rest opens
// its own window and works with the main window closed. The menu rebuilds
// live: recent notes, brains and the unread count come from the renderer
// (setTrayRecent / setTrayState), the sync line from the sync engine.
"use strict";

import { app, dialog, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import * as path from "node:path";

import type { McpInstallStatus, McpTarget, SyncStatus, TrayRecentNote, TrayState, TrayStatus, UpdateState } from "../shared/ipc";
import { showNewBrainWindow, showSettingsWindow, showSpotlight } from "./app-windows";
import { openNewNoteWindow, openNoteWindow } from "./native-ui";
import { captureShortcutState, showQuickCapture } from "./quick-capture";
import { getSettings } from "./settings-store";
import { ws } from "./window-strings";
import { installMcp, mcpStatus } from "./mcp-install";
import { fmt, getMenuLocale, s } from "./menu-strings";
import { getMainWindow, sendRouteToMain } from "./renderer-events";
import { checkForUpdatesInteractive, getUpdateState, installUpdate, subscribeUpdateState } from "./updater";

/** Zekra's remote MCP endpoint (same as Settings ▸ Connect, web /connect). */
const MCP_URL = process.env.ZEKRA_MCP_URL || "https://mcp.zekra.dev";
const MAX_RECENT = 8;

// Tray-only strings (menu-strings.ts carries the shared ones).
const T = {
  en: {
    recent: "Recent Notes",
    mcpInstalled: "MCP: installed in {tools}",
    mcpNone: "MCP: not installed",
    installClaude: "Install for Claude Code…",
    installCursor: "Install for Cursor…",
    installedTitle: "MCP server installed",
    installedBody: "Zekra was added to {tool} ({path}). Restart {tool} to connect.",
    installFailed: "Could not install the MCP server",
    downloading: "Downloading Zekra {version}… {progress}%",
    restartToUpdate: "Restart to Update to {version}",
  },
  ar: {
    recent: "الملاحظات الأخيرة",
    mcpInstalled: "MCP: مثبّت في {tools}",
    mcpNone: "MCP: غير مثبّت",
    installClaude: "التثبيت في Claude Code…",
    installCursor: "التثبيت في Cursor…",
    installedTitle: "تم تثبيت خادم MCP",
    installedBody: "أُضيفت ذكرة إلى {tool} ‏({path}). أعد تشغيل {tool} للاتصال.",
    installFailed: "تعذّر تثبيت خادم MCP",
    downloading: "جارٍ تنزيل ذكرة {version}… {progress}٪",
    restartToUpdate: "أعد التشغيل للتحديث إلى {version}",
  },
} as const;
const tt = () => T[getMenuLocale() === "ar" ? "ar" : "en"];

const TOOL: Record<McpTarget, string> = { claude: "Claude Code", cursor: "Cursor" };

let tray: Tray | null = null;
let status: TrayStatus = { mcp: "unknown" };
let installed: McpInstallStatus = { claude: false, cursor: false };
let recent: TrayRecentNote[] = [];
let showWindow: () => void = () => undefined;
let state: TrayState = { unread: null, brains: [] };
let sync: SyncStatus | null = null;
let syncNow: () => void = () => undefined;

/** out/assets is populated by build/bundle.mjs: the monochrome template on
 *  macOS, the colour icon on Windows (.ico) and Linux (24px PNG). */
function trayIconPath(): string {
  const file = process.platform === "darwin" ? "trayTemplate.png" : process.platform === "win32" ? "icon.ico" : "tray.png";
  return path.join(__dirname, "..", "assets", file);
}

export function createTray(onShow: () => void): void {
  if (tray) return;
  showWindow = onShow;
  const icon = nativeImage.createFromPath(trayIconPath());
  if (icon.isEmpty()) {
    console.warn("[zekra] tray icon missing at", trayIconPath());
    return;
  }
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(s().appName);
  subscribeUpdateState(() => rebuildTrayMenu());
  void refreshMcpStatus();
  rebuildTrayMenu();
}

export function setTrayStatus(next: TrayStatus): void {
  status = next;
  rebuildTrayMenu();
}

/** The main window's unread count + brains (setTrayState). */
export function setTrayState(next: TrayState): void {
  const unread = typeof next?.unread === "number" && Number.isFinite(next.unread) ? Math.max(0, Math.floor(next.unread)) : null;
  const brains = (Array.isArray(next?.brains) ? next.brains : [])
    .filter((b) => b && typeof b.namespace === "string" && b.namespace)
    .slice(0, 40)
    .map((b) => ({ namespace: b.namespace, name: String(b.name || b.namespace).trim().slice(0, 60) }));
  const clean: TrayState = { unread, brains };
  if (JSON.stringify(clean) === JSON.stringify(state)) return;
  state = clean;
  rebuildTrayMenu();
}

/** The sync engine's status (services.ts), and how to sync now. */
export function setTraySync(next: SyncStatus): void {
  const before = sync ? `${sync.state}|${sync.pending}|${sync.lastSyncedAt}|${sync.enabled}` : "";
  sync = next;
  if (before !== `${next.state}|${next.pending}|${next.lastSyncedAt}|${next.enabled}`) rebuildTrayMenu();
}
export function setTraySyncNow(fn: () => void): void {
  syncNow = fn;
}

/** The renderer's recently opened notes (newest first). */
export function setTrayRecent(items: TrayRecentNote[]): void {
  const clean = (Array.isArray(items) ? items : [])
    .filter((r) => r && typeof r.id === "string" && r.id && typeof r.namespace === "string" && r.namespace)
    .slice(0, MAX_RECENT)
    .map((r) => ({ id: r.id, namespace: r.namespace, title: String(r.title ?? "").trim().slice(0, 60) }));
  if (JSON.stringify(clean) === JSON.stringify(recent)) return;
  recent = clean;
  rebuildTrayMenu();
  for (const fn of recentListeners) fn(recent);
}

// The Dock menu (os-integration.ts) shows the same recent notes.
const recentListeners = new Set<(items: TrayRecentNote[]) => void>();
export function onTrayRecentChanged(fn: (items: TrayRecentNote[]) => void): () => void {
  recentListeners.add(fn);
  fn(recent);
  return () => recentListeners.delete(fn);
}

async function refreshMcpStatus(): Promise<void> {
  try {
    installed = await mcpStatus();
  } catch {
    /* keep the last known */
  }
  rebuildTrayMenu();
}

async function install(target: McpTarget): Promise<void> {
  const win = getMainWindow();
  const res = await installMcp(win, target, MCP_URL);
  if (res.status === "cancelled") {
    rebuildTrayMenu(); // undo the checkbox toggle the click made
    return;
  }
  const opts: Electron.MessageBoxOptions =
    res.status === "installed"
      ? {
          type: "info",
          message: tt().installedTitle,
          detail: fmt(tt().installedBody, { tool: TOOL[target], path: res.path ?? "" }),
          buttons: [s().ok],
          noLink: true,
        }
      : { type: "error", message: tt().installFailed, detail: res.message, buttons: [s().ok], noLink: true };
  if (win) await dialog.showMessageBox(win, opts);
  else await dialog.showMessageBox(opts);
  await refreshMcpStatus();
}

function updateItem(u: UpdateState): MenuItemConstructorOptions {
  if (u.status === "downloaded") {
    return { label: fmt(tt().restartToUpdate, { version: u.version ?? "" }), click: () => void installUpdate() };
  }
  if (u.status === "downloading" || u.status === "available") {
    return { label: fmt(tt().downloading, { version: u.version ?? "", progress: String(Math.round(u.progress ?? 0)) }), enabled: false };
  }
  return { label: s().checkUpdates, enabled: u.status !== "checking" && u.status !== "installing", click: () => void checkForUpdatesInteractive() };
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m) || m < 1) return ws().justNow;
  if (m < 60) return fmt(ws().minutesAgo, { n: String(m) });
  return fmt(ws().hoursAgo, { n: String(Math.round(m / 60)) });
}

function syncLine(): string {
  const w = ws();
  if (!sync) return w.syncIdle;
  let text: string;
  switch (sync.state) {
    case "idle":
      text = sync.lastSyncedAt ? fmt(w.syncIdleAt, { when: ago(sync.lastSyncedAt) }) : w.syncIdle;
      break;
    case "syncing":
      text = w.syncSyncing;
      break;
    case "offline":
      text = w.syncOffline;
      break;
    case "paused":
      text = w.syncPaused;
      break;
    case "error":
      text = w.syncError;
      break;
    case "signed-out":
      text = w.syncSignedOut;
      break;
    default:
      text = w.syncDisabled;
  }
  return sync.pending ? `${text} · ${fmt(w.syncPending, { n: String(sync.pending) })}` : text;
}

/** Show the main window and go to a compact route (queued until ready). */
function inMain(route: string): void {
  showWindow();
  sendRouteToMain(route);
}

export function rebuildTrayMenu(): void {
  if (!tray) return;
  const t = s();
  const x = tt();
  const w = ws();
  const tools = (Object.keys(TOOL) as McpTarget[]).filter((k) => installed[k]).map((k) => TOOL[k]);
  const mcpLabel =
    status.label ??
    (status.mcp === "connected"
      ? t.trayMcpConnected
      : status.mcp === "disconnected"
        ? t.trayMcpDisconnected
        : tools.length
          ? fmt(x.mcpInstalled, { tools: tools.join(", ") })
          : x.mcpNone);

  const recentMenu: MenuItemConstructorOptions[] = recent.length
    ? recent.map<MenuItemConstructorOptions>((r) => ({
        label: r.title || w.untitled,
        sublabel: r.namespace,
        click: () => void openNoteWindow({ namespace: r.namespace, id: r.id, title: r.title }),
      }))
    : [{ label: w.noRecent, enabled: false }];

  const brainsMenu: MenuItemConstructorOptions[] = [
    ...(state.brains.length
      ? state.brains.map<MenuItemConstructorOptions>((b) => ({ label: b.name, click: () => inMain(`brain:${b.namespace}`) }))
      : [{ label: w.noBrains, enabled: false } as MenuItemConstructorOptions]),
    { type: "separator" },
    { label: w.allBrains, click: () => inMain("brains") },
  ];

  const signedIn = Boolean(getSettings().authToken);
  const unread = state.unread ?? 0;
  const capture = captureShortcutState().accelerator;

  tray.setToolTip(unread > 0 ? `${t.appName} — ${fmt(w.notificationsUnread, { count: String(unread) })}` : t.appName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: w.open, click: () => showWindow() },
      { type: "separator" },
      { label: w.newNote, enabled: signedIn, click: () => void openNewNoteWindow(getSettings().activeBrain) },
      { label: w.newBrain, enabled: signedIn, click: () => void showNewBrainWindow() },
      { label: w.search, click: () => showSpotlight() },
      { label: w.quickCapture, accelerator: capture || undefined, registerAccelerator: false, click: () => void showQuickCapture() },
      { type: "separator" },
      { label: unread > 0 ? fmt(w.notificationsUnread, { count: String(unread) }) : w.notifications, enabled: signedIn, click: () => inMain("notifications") },
      { label: w.recentNotes, enabled: signedIn, submenu: recentMenu },
      { label: w.brains, enabled: signedIn, submenu: brainsMenu },
      { type: "separator" },
      { label: `● ${syncLine()}`, enabled: false },
      { label: w.syncNow, enabled: signedIn && sync?.state !== "syncing" && sync?.enabled !== false, click: () => syncNow() },
      { type: "separator" },
      { label: `● ${mcpLabel}`, enabled: false },
      { label: x.installClaude, type: "checkbox", checked: installed.claude, click: () => void install("claude") },
      { label: x.installCursor, type: "checkbox", checked: installed.cursor, click: () => void install("cursor") },
      { type: "separator" },
      { label: w.settings, click: () => void showSettingsWindow() },
      updateItem(getUpdateState()),
      {
        label: w.about,
        click: () =>
          process.platform === "win32"
            ? void dialog.showMessageBox({ type: "info", title: w.about, message: t.appName, detail: `${app.getVersion()}\nhttps://zekra.dev`, buttons: [s().ok], noLink: true })
            : app.showAboutPanel(),
      },
      { type: "separator" },
      { label: t.quit, click: () => app.quit() },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
