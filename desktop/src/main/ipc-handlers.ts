// Every ipcMain.handle in the app, one per channel in IPC (src/shared/ipc.ts).
// Keep handlers thin; anything with logic lives in its own module.
"use strict";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  Notification,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
} from "electron";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  IPC,
  type AppInfo,
  type AppSettings,
  type BinaryResponse,
  type ConfirmRequest,
  type NotifyRequest,
  type OpenFileRequest,
  type OpenFileResult,
  type PdfRequest,
  type ProxyRequest,
  type SaveFileRequest,
  type SaveFileResult,
  type SettingsPatch,
  type TrayStatus,
  type McpTarget, // MH-450
} from "../shared/ipc";
import { proxyBinary, proxyRequest } from "./api-proxy";
import { focusMainWindow, markRendererReady, sendNotificationClick } from "./renderer-events";
import { clearSession, getSettings, patchSettings } from "./settings-store";
import { setTrayStatus } from "./tray";
import { checkForUpdates, getUpdateState, installUpdate } from "./updater";
import { installMcp, mcpStatus } from "./mcp-install"; // MH-450 settings ▸ connect
import { registerMarkItDownIpc } from "./importers/ipc"; // MH-450 importers, reveal, tray recents
import { chromeInfo } from "./window-chrome";
import { registerServicesIpc } from "./services"; // offline cache + sync, quick capture, share, login item
import { setAppBadge } from "./os-integration"; // Dock / taskbar overlay / launcher badge

/** Called after a settings patch so main can react (menu locale, theme). */
export type SettingsChanged = (next: AppSettings, patch: SettingsPatch) => void;

export const TITLEBAR_INSET_MAC = 80;

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

// Notifications must be kept referenced or the click handler can be GC'd
// before the user clicks.
const liveNotifications = new Set<Notification>();

export function registerIpc(onSettingsChanged: SettingsChanged): void {
  /* ------------------------------------------------------- settings */
  ipcMain.handle(IPC.settingsGet, (): AppSettings => getSettings());
  ipcMain.handle(IPC.settingsPatch, (_e, patch: SettingsPatch): AppSettings => {
    // windowBounds is owned by main (window-state.ts).
    const { windowBounds: _ignored, ...safe } = (patch ?? {}) as SettingsPatch & { windowBounds?: unknown };
    const next = patchSettings(safe);
    onSettingsChanged(next, safe);
    return next;
  });
  ipcMain.handle(IPC.settingsClearSession, (): AppSettings => clearSession());

  /* ------------------------------------------------------------ app */
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
    arch: process.arch,
    isPackaged: app.isPackaged,
    ...chromeInfo(), // window controls, frame kind, title-bar height, material (window-chrome.ts)
  }));
  ipcMain.handle(IPC.appOpenExternal, async (_e, url: string): Promise<void> => {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      await shell.openExternal(url);
    }
  });
  ipcMain.handle(IPC.appRendererReady, (): void => markRendererReady());
  ipcMain.handle(IPC.appShowAbout, (): void => app.showAboutPanel());

  /* -------------------------------------------------------- network */
  // The renderer runs from file:// and so sends Origin: null, which the API
  // rejects on purpose. net.request runs here, where CORS does not apply.
  ipcMain.handle(IPC.apiRequest, async (_e, req: ProxyRequest) => proxyRequest(req));
  ipcMain.handle(IPC.apiBinary, async (_e, pathOrUrl: string): Promise<BinaryResponse> => {
    const { apiBaseUrl, authToken } = getSettings();
    try {
      return await proxyBinary(apiBaseUrl, String(pathOrUrl), authToken);
    } catch {
      return { ok: false, status: 0, contentType: "", bytes: null };
    }
  });

  /* -------------------------------------------------------- dialogs */
  ipcMain.handle(IPC.dialogSave, async (e, req: SaveFileRequest): Promise<SaveFileResult> => {
    const win = senderWindow(e);
    const opts: Electron.SaveDialogOptions = {
      title: req.title,
      defaultPath: path.join(app.getPath("documents"), sanitiseFileName(req.suggestedName)),
      filters: req.filters,
    };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { canceled: true };
    let data: Buffer;
    if (req.text !== undefined) data = Buffer.from(req.text, "utf8");
    else if (req.bytes) data = Buffer.from(req.bytes);
    else if (req.base64 !== undefined) data = Buffer.from(req.base64, "base64");
    else throw new Error("saveFile: one of text / bytes / base64 is required");
    await fs.writeFile(result.filePath, data);
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle(IPC.dialogOpen, async (e, req: OpenFileRequest): Promise<OpenFileResult> => {
    const win = senderWindow(e);
    const properties: Electron.OpenDialogOptions["properties"] = [req.directory ? "openDirectory" : "openFile"];
    if (req.multiple) properties.push("multiSelections");
    const opts: Electron.OpenDialogOptions = { title: req.title, filters: req.filters, properties };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled) return { canceled: true, files: [] };
    const files = await Promise.all(
      result.filePaths.map(async (p) => {
        const file: { path: string; name: string; content?: string } = { path: p, name: path.basename(p) };
        if (req.read && !req.directory) file.content = (await fs.readFile(p)).toString(req.read === "utf8" ? "utf8" : "base64");
        return file;
      }),
    );
    return { canceled: false, files };
  });

  ipcMain.handle(IPC.dialogConfirm, async (e, req: ConfirmRequest): Promise<{ response: number }> => {
    const win = senderWindow(e);
    const opts: Electron.MessageBoxOptions = {
      type: req.type ?? "question",
      message: req.message,
      detail: req.detail,
      buttons: req.buttons?.length ? req.buttons : ["OK", "Cancel"],
      defaultId: req.defaultId ?? 0,
      cancelId: req.cancelId ?? 1,
      noLink: true,
    };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return { response };
  });

  /* ------------------------------------------------------------ pdf */
  ipcMain.handle(IPC.printToPdf, async (_e, req: PdfRequest): Promise<Uint8Array> => new Uint8Array(await htmlToPdf(req)));

  /* -------------------------------------------------- notifications */
  ipcMain.handle(IPC.notify, (_e, req: NotifyRequest): void => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: req.title, body: req.body ?? "", silent: req.silent });
    liveNotifications.add(n);
    n.on("click", () => {
      focusMainWindow();
      sendNotificationClick({ route: req.route });
      liveNotifications.delete(n);
    });
    n.on("close", () => liveNotifications.delete(n));
    n.show();
  });

  /* -------------------------------------------------------- touch id */
  ipcMain.handle(IPC.touchIdCan, (): boolean =>
    process.platform === "darwin" ? systemPreferences.canPromptTouchID() : false,
  );
  ipcMain.handle(IPC.touchIdPrompt, async (_e, reason: string): Promise<{ ok: boolean; error?: string }> => {
    if (process.platform !== "darwin" || !systemPreferences.canPromptTouchID()) {
      return { ok: false, error: "unavailable" };
    }
    try {
      await systemPreferences.promptTouchID(String(reason || "unlock Zekra"));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? "cancelled" };
    }
  });

  /* ------------------------------------------------------ clipboard */
  ipcMain.handle(IPC.clipboardWriteText, (_e, text: string): void => clipboard.writeText(String(text ?? "")));
  // MH-450 vault: a copied secret is wiped after a delay, but only if the
  // clipboard still holds it — never clobber something the user copied since.
  ipcMain.handle(IPC.clipboardWriteSecret, (_e, text: string, clearAfterMs: number): void => {
    const secret = String(text ?? "");
    clipboard.writeText(secret);
    const ms = Math.min(Math.max(Number(clearAfterMs) || 60_000, 1_000), 10 * 60_000);
    setTimeout(() => {
      if (clipboard.readText() === secret) clipboard.clear();
    }, ms).unref?.();
  });

  /* --------------------------------------------------------- window */
  ipcMain.handle(IPC.windowSetEdited, (e, edited: boolean): void => {
    senderWindow(e)?.setDocumentEdited(Boolean(edited));
  });
  ipcMain.handle(IPC.windowClose, (e): void => senderWindow(e)?.close());

  /* -------------------------------------------------------- updates */
  ipcMain.handle(IPC.updateCheck, () => checkForUpdates());
  ipcMain.handle(IPC.updateGetState, () => getUpdateState());
  ipcMain.handle(IPC.updateInstall, () => installUpdate());

  /* ----------------------------------------------------------- tray */
  ipcMain.handle(IPC.traySetStatus, (_e, status: TrayStatus): void => setTrayStatus(status));

  /* ------------------------------ MH-450 dock badge + MCP install */
  // Unread notifications on the Dock icon (0 clears it).
  ipcMain.handle(IPC.appSetBadge, (_e, count: number): void => {
    const n = Math.max(0, Math.min(9999, Math.floor(Number(count) || 0)));
    setAppBadge(n); // macOS Dock, Windows taskbar overlay, Linux launcher (os-integration.ts)
  });
  // Settings ▸ Connect: native confirm + backup + atomic write (mcp-install.ts).
  ipcMain.handle(IPC.mcpInstall, (e, target: McpTarget, url: string) => installMcp(senderWindow(e), target, url));
  ipcMain.handle(IPC.mcpStatus, () => mcpStatus());

  // MH-450 Mark It Down features: importers, reveal in Finder, tray recents.
  registerMarkItDownIpc();
  registerServicesIpc(); // desktop services (services.ts)
}

function sanitiseFileName(name: string): string {
  return String(name || "Untitled").replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "-").slice(0, 200);
}

/**
 * HTML -> PDF with Chromium's print pipeline. The HTML is written to a temp
 * file rather than loaded as a data: URL: exports with inline images easily
 * exceed the ~2 MB Chromium accepts in a URL. The window is hidden, sandboxed,
 * has no preload, and may not navigate or open windows.
 */
async function htmlToPdf(req: PdfRequest): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zekra-pdf-"));
  const file = path.join(dir, "export.html");
  await fs.writeFile(file, req.html, "utf8");
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1400,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, offscreen: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  try {
    await win.loadFile(file);
    // Let web fonts and images settle before printing.
    await win.webContents
      .executeJavaScript(
        "Promise.race([Promise.all([document.fonts ? document.fonts.ready : null, ...Array.from(document.images).map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))]), new Promise(r => setTimeout(r, 5000))]).then(() => true)",
        true,
      )
      .catch(() => undefined);
    const m = req.margins ?? {};
    return await win.webContents.printToPDF({
      pageSize: req.pageSize ?? "A4",
      landscape: Boolean(req.landscape),
      printBackground: req.printBackground ?? true,
      margins: { top: m.top ?? 0.5, bottom: m.bottom ?? 0.5, left: m.left ?? 0.5, right: m.right ?? 0.5 },
    });
  } finally {
    win.destroy();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Keep `nativeTheme` in step with the app's theme choice. */
export function applyThemeSource(theme: AppSettings["theme"]): void {
  nativeTheme.themeSource = theme;
}
