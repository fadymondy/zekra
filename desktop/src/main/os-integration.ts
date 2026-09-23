// OS integration, per platform — each service has its native equivalent:
//
//   service          macOS                         Windows                         Linux
//   ───────────────  ────────────────────────────  ──────────────────────────────  ─────────────────────────────
//   login item       SMAppService login item       Run key (setLoginItemSettings)  ~/.config/autostart/*.desktop
//   start hidden     wasOpenedAtLogin (+ <13:      "--hidden" arg                  "--hidden" arg
//                    openAsHidden)
//   app shortcuts    Dock menu (app.dock.setMenu)  Jump List tasks (setUserTasks)  — (.desktop Actions: packaging)
//   unread badge     Dock badge (setBadgeCount)    taskbar overlay icon            Unity launcher (setBadgeCount)
//   share a note     ShareMenu (NSSharingService)  clipboard / mailto fallback     clipboard / mailto fallback
//                                                  (no Share sheet in Electron)
//   rich notifs      actions + inline reply        toast buttons (toastXml,        click only (Electron has no
//                                                  protocol activation; needs the  Linux actions)
//                                                  AUMID shortcut NSIS creates)
//   recent docs      addRecentDocument + Open      addRecentDocument (Jump List    —
//                    Recent menu                   "Recent")
//
// Handoff / NSUserActivity, a Services-menu provider and a Share extension
// (app extensions) are out of scope: Electron cannot ship app extensions.
"use strict";

import { app, BrowserWindow, clipboard, Menu, nativeImage, Notification, shell, type MenuItemConstructorOptions } from "electron";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { IPC, type NotificationActionEvent, type RichNotifyRequest, type ShareRequest, type ShareResult, type TrayRecentNote } from "../shared/ipc";
import { badgeBitmap } from "./badge-bitmap";
import { openNewNoteWindow, openNoteWindow } from "./native-ui";
import { broadcast, focusMainWindow, sendNotificationClick } from "./renderer-events";
import { ss } from "./services-strings";
import { getSettings } from "./settings-store";

const platform = process.platform;

/* ------------------------------------------------------------ login item */

const LINUX_AUTOSTART = () => path.join(os.homedir(), ".config", "autostart", "zekra-desktop.desktop");

/** The executable a login launch should run (AppImage path when bundled so). */
function linuxExec(): string {
  return process.env.APPIMAGE || process.execPath;
}

export async function applyLoginItem(open: boolean, hidden: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!app.isPackaged) {
    // Registering the bare Electron binary would launch the Electron demo app.
    return { ok: false, message: "development build: login item not registered" };
  }
  try {
    if (platform === "darwin") {
      // openAsHidden only works before macOS 13; later, main checks
      // wasOpenedAtLogin at launch (startHidden()).
      app.setLoginItemSettings({ openAtLogin: open, openAsHidden: hidden });
    } else if (platform === "win32") {
      app.setLoginItemSettings({ openAtLogin: open, path: process.execPath, args: hidden ? ["--hidden"] : [] });
    } else {
      const file = LINUX_AUTOSTART();
      if (open) {
        const exec = `"${linuxExec().replace(/"/g, '\\"')}"${hidden ? " --hidden" : ""}`;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
          file,
          [
            "[Desktop Entry]",
            "Type=Application",
            "Name=Zekra",
            "Comment=Zekra — memory for you and your AI agents",
            `Exec=${exec}`,
            "Icon=zekra-desktop",
            "Terminal=false",
            "X-GNOME-Autostart-enabled=true",
            "",
          ].join("\n"),
          "utf8",
        );
      } else {
        await fs.rm(file, { force: true });
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Whether the OS will start Zekra at login right now. */
export async function loginItemEnabled(): Promise<boolean> {
  if (platform === "linux") {
    try {
      await fs.access(LINUX_AUTOSTART());
      return true;
    } catch {
      return false;
    }
  }
  if (platform === "win32") {
    return app.getLoginItemSettings({ path: process.execPath, args: getSettings().openAtLoginHidden ? ["--hidden"] : [] }).openAtLogin;
  }
  return app.getLoginItemSettings().openAtLogin;
}

/** Launched by the login item with "open hidden" on: tray / menubar only. */
export function startHidden(): boolean {
  if (process.argv.includes("--hidden")) return true;
  if (platform !== "darwin") return false;
  const s = getSettings();
  if (!s.launchAtLogin || !s.openAtLoginHidden) return false;
  const li = app.getLoginItemSettings() as Electron.LoginItemSettings & { wasOpenedAtLogin?: boolean; wasOpenedAsHidden?: boolean };
  return Boolean(li.wasOpenedAtLogin || li.wasOpenedAsHidden);
}

/* ------------------------------------------------ Dock menu / Jump List */

let recent: TrayRecentNote[] = [];
let openCapture: () => void = () => undefined;
let showMain: () => void = () => undefined;

export function initAppShortcuts(opts: { openCapture: () => void; showMain: () => void }): void {
  openCapture = opts.openCapture;
  showMain = opts.showMain;
  rebuildAppShortcuts();
}

export function setRecentForDock(items: TrayRecentNote[]): void {
  recent = items.slice(0, 5);
  rebuildAppShortcuts();
}

/** Dock menu (macOS) / Jump List tasks (Windows). Rebuilt on locale change. */
export function rebuildAppShortcuts(): void {
  const t = ss();
  if (platform === "darwin" && app.dock) {
    const items: MenuItemConstructorOptions[] = [
      { label: t.newNote, click: () => void openNewNoteWindow(getSettings().activeBrain) },
      { label: t.quickCapture, click: () => openCapture() },
    ];
    if (recent.length) {
      items.push({ type: "separator" }, { label: t.recentNotes, enabled: false });
      for (const r of recent) {
        items.push({
          label: r.title || t.untitled,
          click: () => void openNoteWindow({ namespace: r.namespace, id: r.id, title: r.title }),
        });
      }
    }
    app.dock.setMenu(Menu.buildFromTemplate(items));
  } else if (platform === "win32") {
    // Tasks relaunch the exe with a zekra:// URL; the single-instance lock
    // hands it to this process (second-instance -> deep-links interceptor).
    try {
      app.setUserTasks([
        { program: process.execPath, arguments: "zekra://app/new-note", iconPath: process.execPath, iconIndex: 0, title: t.newNote, description: t.newNoteDesc },
        { program: process.execPath, arguments: "zekra://app/capture", iconPath: process.execPath, iconIndex: 0, title: t.quickCapture, description: t.quickCaptureDesc },
      ]);
    } catch (err) {
      console.warn("[zekra] jump list", err);
    }
  }
}

/** zekra://app/<action> from a Jump List task / a script. True when handled. */
export function handleAppLink(host: string, pathPart: string): boolean {
  if (host !== "app") return false;
  if (pathPart === "capture") openCapture();
  else if (pathPart === "new-note") void openNewNoteWindow(getSettings().activeBrain);
  else if (pathPart === "open") showMain();
  else return false;
  return true;
}

/* ------------------------------------------------------------ the badge */

let lastBadge = -1;

/** Unread count on the Dock (macOS), taskbar overlay (Windows) or launcher (Linux/Unity). */
export function setAppBadge(count: number): void {
  const n = Math.max(0, Math.min(9999, Math.floor(Number(count) || 0)));
  lastBadge = n;
  if (platform === "win32") {
    applyOverlay(n);
    return;
  }
  app.setBadgeCount(n);
}

function applyOverlay(n: number): void {
  const bitmap = badgeBitmap(n);
  const image = bitmap ? nativeImage.createFromBitmap(bitmap, { width: 32, height: 32, scaleFactor: 2 }) : null;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.getParentWindow()) continue;
    try {
      win.setOverlayIcon(image, n ? `${n} unread` : "");
    } catch {
      /* not a taskbar window */
    }
  }
}

/** New taskbar windows get the current overlay. */
export function reapplyOverlay(): void {
  if (platform === "win32" && lastBadge > 0) applyOverlay(lastBadge);
}

/* ---------------------------------------------------------------- share */

function webNoteUrl(ns?: string, id?: string): string | undefined {
  if (!ns || !id || id.startsWith("local:")) return undefined;
  const base = getSettings().apiBaseUrl.replace(/\/+$/, "");
  return `${base}/b/${encodeURIComponent(ns)}/notes?id=${encodeURIComponent(id)}`;
}

function safeFileName(name: string): string {
  return (name || "Note").replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "-").slice(0, 120);
}

export async function shareNote(win: BrowserWindow | null, req: ShareRequest): Promise<ShareResult> {
  const title = String(req?.title ?? "").trim();
  const markdown = String(req?.markdown ?? "");
  const url = webNoteUrl(req?.namespace, req?.id);
  if (platform === "darwin") {
    try {
      const { ShareMenu } = await import("electron");
      const filePaths: string[] = [];
      if (req.asFile) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zekra-share-"));
        const file = path.join(dir, `${safeFileName(title)}.md`);
        await fs.writeFile(file, markdown, "utf8");
        filePaths.push(file);
        setTimeout(() => void fs.rm(dir, { recursive: true, force: true }), 10 * 60_000).unref?.();
      }
      const menu = new ShareMenu({ texts: [markdown], ...(url ? { urls: [url] } : {}), ...(filePaths.length ? { filePaths } : {}) });
      menu.popup({ window: win ?? undefined });
      return { status: "shared", method: "share-menu" };
    } catch (err) {
      return { status: "error", method: "share-menu", message: (err as Error).message };
    }
  }
  // Windows / Linux: Electron has no share sheet. Copy the note; the renderer
  // may offer "Email…" (req.asFile false + mailto) as a second step.
  const text = url ? `${markdown}\n\n${url}` : markdown;
  clipboard.writeText(text);
  return { status: "copied", method: "clipboard", message: ss().sharedCopied };
}

/** Windows / Linux "Email…" fallback: a mailto: with the note (truncated). */
export async function shareByMail(req: ShareRequest): Promise<ShareResult> {
  const url = webNoteUrl(req.namespace, req.id);
  const body = `${String(req.markdown ?? "").slice(0, 1800)}${url ? `\n\n${url}` : ""}`;
  await shell.openExternal(`mailto:?subject=${encodeURIComponent(req.title || "")}&body=${encodeURIComponent(body)}`);
  return { status: "shared", method: "mailto" };
}

/* ------------------------------------------------- rich notifications */

const liveNotifications = new Set<Notification>();

function xml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function notificationLink(action: string, req: RichNotifyRequest): string {
  const qs = new URLSearchParams();
  if (req.route) qs.set("route", req.route);
  if (req.tag) qs.set("tag", req.tag);
  return `zekra://notification/${encodeURIComponent(action)}?${qs.toString()}`;
}

/** Whether the platform shows action buttons on notifications. */
export function notificationActionsSupported(): boolean {
  return platform === "darwin" || platform === "win32";
}

function deliverAction(e: NotificationActionEvent): void {
  if (e.action === "click" || e.action === "open") {
    focusMainWindow();
    if (e.route) sendNotificationClick({ route: e.route });
  }
  broadcast(IPC.evNotificationAction, e);
}

/** zekra://notification/<action>?route=&tag= (Windows toast activation). */
export function handleNotificationLink(host: string, pathPart: string, params: Record<string, string>): boolean {
  if (host !== "notification") return false;
  deliverAction({ action: decodeURIComponent(pathPart || "click"), route: params.route, tag: params.tag });
  return true;
}

export function notifyRich(req: RichNotifyRequest): void {
  if (!Notification.isSupported()) return;
  const actions = (req.actions ?? []).slice(0, platform === "win32" ? 5 : 10).filter((a) => a && a.id && a.label);
  let n: Notification;
  if (platform === "win32" && (actions.length || req.reply)) {
    // Toast XML: buttons activate zekra:// links -> second-instance -> handleNotificationLink.
    const buttons = actions
      .map((a) => `<action content="${xml(a.label)}" activationType="protocol" arguments="${xml(notificationLink(a.id, req))}"/>`)
      .join("");
    const toastXml =
      `<toast launch="${xml(notificationLink("click", req))}" activationType="protocol">` +
      `<visual><binding template="ToastGeneric"><text>${xml(req.title)}</text><text>${xml(req.body ?? "")}</text></binding></visual>` +
      (req.silent ? `<audio silent="true"/>` : "") +
      `<actions>${buttons}</actions></toast>`;
    n = new Notification({ toastXml });
  } else {
    n = new Notification({
      title: req.title,
      body: req.body ?? "",
      silent: req.silent,
      ...(platform === "darwin"
        ? {
            actions: actions.map((a) => ({ type: "button" as const, text: a.label })),
            hasReply: Boolean(req.reply),
            replyPlaceholder: req.reply?.placeholder,
          }
        : {}),
    });
  }
  liveNotifications.add(n);
  const done = () => liveNotifications.delete(n);
  n.on("click", () => {
    deliverAction({ action: "click", route: req.route, tag: req.tag });
    done();
  });
  n.on("action", (_e, index) => {
    const a = actions[index];
    if (a) deliverAction({ action: a.id, route: req.route, tag: req.tag });
    done();
  });
  n.on("reply", (_e, reply) => {
    deliverAction({ action: "reply", reply, route: req.route, tag: req.tag });
    done();
  });
  n.on("close", done);
  n.show();
}

/* ------------------------------------------------------- about + recents */

export function setAboutPanel(appName: string, appNameAr: string): void {
  app.setAboutPanelOptions({
    applicationName: appName,
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} ${appName} (${appNameAr}) — Fady Mondy`,
    credits: "Memory for you and your AI agents.\nBuilt with Electron, React and the Zekra brain API.",
    authors: ["Fady Mondy"],
    website: "https://zekra.dev",
    ...(platform === "linux" ? { iconPath: path.join(__dirname, "..", "assets", "icon.png") } : {}),
  });
}

/** An opened .md file joins the OS's recent documents (Open Recent / Jump List). */
export function addRecentDocument(filePath: string): void {
  if (platform === "darwin" || platform === "win32") {
    try {
      app.addRecentDocument(filePath);
    } catch {
      /* not fatal */
    }
  }
}

