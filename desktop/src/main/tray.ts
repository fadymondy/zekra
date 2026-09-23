// Menubar (tray) item: the monochrome Zekra mark as a template image, so macOS
// tints it for light/dark menubars. Mark It Down-grade menu (MH-450):
//
//   Open Zekra
//   New Note
//   Search…
//   ── Recent notes ──            last 5 opened, pushed by the renderer
//   <note> …                      (window.zekra.setTrayRecent)
//   ───────────────
//   ● MCP: …                      status line (setTrayStatus, else what is
//   Install for Claude Code…      installed); the installers are the Settings ▸
//   Install for Cursor…           Connect ones (mcp-install.ts), confirm + backup
//   ───────────────
//   Check for Updates…            relabels itself: Downloading… / Restart to Update
//   ───────────────
//   Quit Zekra
//
// Everything that needs the renderer (New Note, Search, a recent note) goes
// through the READY queue (renderer-events.ts): with the window closed, the
// click creates it and the command lands once it has loaded — Mark It Down's
// "New Note from the tray does nothing when the window is closed" bug.
"use strict";

import { app, dialog, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import * as path from "node:path";

import type { McpInstallStatus, McpTarget, TrayRecentNote, TrayStatus, UpdateState } from "../shared/ipc";
import { installMcp, mcpStatus } from "./mcp-install";
import { fmt, getMenuLocale, s } from "./menu-strings";
import { getMainWindow, sendCommandWhenReady, sendNotificationClick } from "./renderer-events";
import { checkForUpdatesInteractive, getUpdateState, installUpdate, subscribeUpdateState } from "./updater";

/** Zekra's remote MCP endpoint (same as Settings ▸ Connect, web /connect). */
const MCP_URL = process.env.ZEKRA_MCP_URL || "https://mcp.zekra.dev";
const MAX_RECENT = 5;

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

/** out/assets is populated by build/bundle.mjs from build/trayTemplate*.png. */
function trayIconPath(): string {
  return path.join(__dirname, "..", "assets", "trayTemplate.png");
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

/** The renderer's recently opened notes (newest first). */
export function setTrayRecent(items: TrayRecentNote[]): void {
  const clean = (Array.isArray(items) ? items : [])
    .filter((r) => r && typeof r.id === "string" && r.id && typeof r.namespace === "string" && r.namespace)
    .slice(0, MAX_RECENT)
    .map((r) => ({ id: r.id, namespace: r.namespace, title: String(r.title ?? "").trim().slice(0, 60) }));
  if (JSON.stringify(clean) === JSON.stringify(recent)) return;
  recent = clean;
  rebuildTrayMenu();
}

async function refreshMcpStatus(): Promise<void> {
  try {
    installed = await mcpStatus();
  } catch {
    /* keep the last known */
  }
  rebuildTrayMenu();
}

/** Show the window, then run `fn` — queued until the renderer is ready. */
function withWindow(fn: () => void): void {
  showWindow();
  fn();
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
    return { label: fmt(tt().downloading, { version: u.version ?? "", progress: String(u.progress ?? 0) }), enabled: false };
  }
  return { label: s().checkUpdates, enabled: u.status !== "checking", click: () => void checkForUpdatesInteractive() };
}

export function rebuildTrayMenu(): void {
  if (!tray) return;
  const t = s();
  const x = tt();
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

  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? [
        { type: "separator" },
        { label: x.recent, enabled: false },
        ...recent.map<MenuItemConstructorOptions>((r) => ({
          label: r.title || "Untitled",
          sublabel: r.namespace,
          // The shell's generic "open this route" path (routeFromString), and
          // buffered until the renderer is ready like the commands above.
          click: () => withWindow(() => sendNotificationClick({ route: `note:${r.namespace}:${r.id}` })),
        })),
      ]
    : [];

  tray.setToolTip(t.appName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t.trayOpen, click: () => showWindow() },
      { label: t.newNote, click: () => withWindow(() => sendCommandWhenReady("new-note", "tray")) },
      { label: t.traySearch, click: () => withWindow(() => sendCommandWhenReady("spotlight", "tray")) },
      ...recentItems,
      { type: "separator" },
      { label: `● ${mcpLabel}`, enabled: false },
      { label: x.installClaude, type: "checkbox", checked: installed.claude, click: () => void install("claude") },
      { label: x.installCursor, type: "checkbox", checked: installed.cursor, click: () => void install("cursor") },
      { type: "separator" },
      updateItem(getUpdateState()),
      { type: "separator" },
      { label: t.quit, click: () => app.quit() },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
