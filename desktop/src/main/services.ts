// Desktop services — wiring. The modules that do the work:
//
//   offline/sync-core.ts   pure sync logic (merge, queue, conflicts, backoff)
//   offline/store.ts       the on-disk cache (atomic JSON documents)
//   offline/engine.ts      the background sync engine (Electron-free)
//   quick-capture.ts       global shortcut + floating capture panel
//   browser-tab.ts         active browser tab (macOS AppleScript)
//   os-integration.ts      login item, Dock menu / Jump List, badge, share,
//                          rich notifications, about panel, recent documents
//
// This file connects them to Electron (net via api-proxy, settings-store,
// powerMonitor, app events) and registers their IPC. main.ts calls
// installDesktopServices() once after the tray exists, and
// servicesOnSettingsChanged() after every settings patch; ipc-handlers.ts
// calls registerServicesIpc().
"use strict";

import { app, BrowserWindow, ipcMain, nativeTheme, net, powerMonitor, type IpcMainInvokeEvent } from "electron";
import { execFile } from "node:child_process";
import * as path from "node:path";

import {
  IPC,
  type AppSettings,
  type CaptureInit,
  type CaptureSaveRequest,
  type CaptureSaveResult,
  type OfflineEdit,
  type OfflineQuery,
  type RichNotifyRequest,
  type ServicesInfo,
  type SettingsPatch,
  type ShareRequest,
  type ShortcutResult,
} from "../shared/ipc";
import { proxyRequest } from "./api-proxy";
import { setDeepLinkInterceptor } from "./deep-links";
import { SyncEngine, type HttpResponse } from "./offline/engine";
import { OfflineStore } from "./offline/store";
import {
  addRecentDocument,
  applyLoginItem,
  handleAppLink,
  handleNotificationLink,
  initAppShortcuts,
  loginItemEnabled,
  notificationActionsSupported,
  notifyRich,
  rebuildAppShortcuts,
  reapplyOverlay,
  setAboutPanel,
  setRecentForDock,
  shareByMail,
  shareNote,
  startHidden,
} from "./os-integration";
import {
  applyCaptureShortcut,
  captureBrowserTab,
  captureClipboard,
  captureShortcutState,
  captureWindow,
  defaultCaptureShortcut,
  destroyCaptureWindow,
  disposeQuickCapture,
  displayAccelerator,
  hideQuickCapture,
  initQuickCapture,
  prewarmQuickCapture,
  showQuickCapture,
} from "./quick-capture";
import { installMenu } from "./menu";
import { isWindows11 } from "./window-chrome";
import { broadcast, setCommandTargetFilter } from "./renderer-events";
import { ss } from "./services-strings";
import { getSettings, patchSettings } from "./settings-store";
import { onTrayRecentChanged } from "./tray";
import { installingUpdate } from "./updater";

export { startHidden, addRecentDocument };

const REQUEST_TIMEOUT_MS = 30_000;
const NET_POLL_MS = 15_000;
const LOW_POWER_POLL_MS = 120_000;

let engine: SyncEngine | null = null;

/** Every API call the engine makes: through the main-process proxy with the
 *  stored bearer token (the renderer is not involved). */
async function http(method: string, p: string, json?: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
  const s = getSettings();
  const h: Record<string, string> = { Accept: "application/json", "X-Agent-Id": "zekra-desktop", ...headers };
  if (s.authToken) h.Authorization = `Bearer ${s.authToken}`;
  if (json !== undefined) h["Content-Type"] = "application/json";
  const req = proxyRequest({ baseUrl: s.apiBaseUrl, path: p, method, headers: h, body: json === undefined ? undefined : JSON.stringify(json) });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), REQUEST_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([req, timeout]);
    return { status: res.status, body: res.body };
  } finally {
    clearTimeout(timer);
  }
}

export function getEngine(): SyncEngine {
  if (engine) return engine;
  engine = new SyncEngine({
    store: new OfflineStore(path.join(app.getPath("userData"), "offline-cache")),
    http,
    auth: () => {
      const s = getSettings();
      return { apiBaseUrl: s.apiBaseUrl, token: s.authToken, userId: s.authUser?.id ?? null, email: s.authUser?.email };
    },
    enabled: () => getSettings().offlineCacheEnabled,
    intervalMinutes: () => getSettings().syncIntervalMinutes,
    isOnline: () => net.isOnline(),
    onStatus: (status) => broadcast(IPC.evSyncStatus, status),
    onChange: (change) => broadcast(IPC.evSyncChange, change),
    conflictLabel: () => ss().conflictedCopy,
    log: (...a) => console.warn(...a),
  });
  return engine;
}

/* ----------------------------------------------------------------- IPC */

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

async function servicesInfo(): Promise<ServicesInfo> {
  const sc = captureShortcutState();
  const platform = process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
  return {
    platform,
    quickCaptureShortcut: sc.accelerator,
    defaultShortcut: defaultCaptureShortcut(),
    shortcutRegistered: sc.registered,
    shortcutError: sc.error,
    launchAtLogin: await loginItemEnabled().catch(() => false),
    shareMenu: platform === "darwin",
    browserCapture: platform === "darwin",
    notificationActions: notificationActionsSupported(),
  };
}

async function captureInit(): Promise<CaptureInit> {
  const s = getSettings();
  const e = getEngine();
  let brains = (await e.brains()).brains;
  if (!brains.length) brains = (await e.refreshBrains()).brains;
  const platform = process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
  return {
    brains: brains
      .filter((b) => b.canWrite)
      .map((b) => ({ namespace: b.namespace, displayName: b.displayName, icon: b.icon, colorHex: b.colorHex, canWrite: b.canWrite })),
    lastBrain: s.quickCaptureBrain ?? s.activeBrain,
    locale: s.locale,
    dark: nativeTheme.shouldUseDarkColors,
    platform,
    material: platform === "darwin" ? "vibrancy" : platform === "win32" && isWindows11() ? "acrylic" : "none",
    shortcut: displayAccelerator(captureShortcutState().accelerator),
    browserCapture: platform === "darwin",
    signedIn: Boolean(s.authToken && s.authUser),
    online: e.isOnline,
  };
}

async function captureSave(req: CaptureSaveRequest): Promise<CaptureSaveResult> {
  const ns = String(req?.namespace ?? "");
  const title = String(req?.title ?? "").trim();
  const body = String(req?.body ?? "");
  const tags = (Array.isArray(req?.tags) ? req.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  if (!ns || (!title && !body.trim())) return { ok: false, queued: false, error: "empty" };
  patchSettings({ quickCaptureBrain: ns });
  const e = getEngine();
  const res = await e.enqueue({ kind: "create", namespace: ns, patch: { title, body, tags, category: "note" }, source: "desktop-capture" });
  if (res.ok) return { ok: true, queued: !e.isOnline };
  if (res.error !== "disabled") return { ok: false, queued: false, error: res.error };
  // Offline cache turned off: a plain online create.
  try {
    const r = await http("POST", "/api/notes", { namespace: ns, title, body, tags, category: "note", pinned: false, source: "desktop-capture" });
    return r.status >= 200 && r.status < 300 ? { ok: true, queued: false } : { ok: false, queued: false, error: `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, queued: false, error: (err as Error).message };
  }
}

export function registerServicesIpc(): void {
  const e = () => getEngine();
  // offline cache + sync
  ipcMain.handle(IPC.offlineNotes, (_ev, ns: string, q?: OfflineQuery) => e().notes(String(ns ?? ""), q ?? {}));
  ipcMain.handle(IPC.offlineNote, (_ev, ns: string, id: string) => e().note(String(ns ?? ""), String(id ?? "")));
  ipcMain.handle(IPC.offlineBrains, () => e().brains());
  ipcMain.handle(IPC.offlineVersions, (_ev, ns: string, id: string) => e().versions(String(ns ?? ""), String(id ?? "")));
  ipcMain.handle(IPC.offlinePut, (_ev, note: unknown) => e().put(note));
  ipcMain.handle(IPC.offlineEnqueue, (_ev, edit: OfflineEdit) => e().enqueue(edit));
  ipcMain.handle(IPC.offlineResolveBase, (_ev, id: string, version: number) => e().resolveBase(String(id ?? ""), Number(version) || 0));
  ipcMain.handle(IPC.offlineSyncNow, () => e().syncNow());
  ipcMain.handle(IPC.offlineStatus, () => e().status());
  ipcMain.handle(IPC.offlineClear, (_ev, includeQueue?: boolean) => e().clear(Boolean(includeQueue)));
  ipcMain.handle(IPC.offlineDismissConflict, (_ev, id: string) => e().dismissConflict(String(id ?? "")));
  // quick capture
  ipcMain.handle(IPC.captureOpen, () => showQuickCapture());
  ipcMain.handle(IPC.captureInit, () => captureInit());
  ipcMain.handle(IPC.captureSave, (_ev, req: CaptureSaveRequest) => captureSave(req));
  ipcMain.handle(IPC.captureClose, () => hideQuickCapture());
  ipcMain.handle(IPC.captureClipboard, () => captureClipboard());
  ipcMain.handle(IPC.captureBrowserTab, () => captureBrowserTab());
  // os services
  ipcMain.handle(IPC.servicesInfo, () => servicesInfo());
  ipcMain.handle(IPC.servicesSetShortcut, (_ev, accel: string | null): ShortcutResult => {
    const want = accel === null || accel === undefined ? null : String(accel);
    const res = applyCaptureShortcut(want);
    if (res.ok) patchSettings({ quickCaptureShortcut: want });
    else applyCaptureShortcut(getSettings().quickCaptureShortcut); // put the old one back
    installMenu();
    return res;
  });
  ipcMain.handle(IPC.shareNote, (ev, req: ShareRequest) =>
    req?.via === "mail" ? shareByMail(req) : shareNote(senderWindow(ev), req),
  );
  ipcMain.handle(IPC.notifyRich, (_ev, req: RichNotifyRequest): void => notifyRich(req));
}

/* ------------------------------------------------------------- install */

function lowPowerMode(): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("/usr/bin/pmset", ["-g"], { timeout: 2_000, encoding: "utf8" }, (err, out) => {
      resolve(!err && /\blowpowermode\s+1\b/.test(String(out)));
    });
  });
}

let installed = false;

/** Call once after "ready", after the main window and tray exist. */
export function installDesktopServices(opts: { showMainWindow: () => void; appName: string; appNameAr: string }): void {
  if (installed) return;
  installed = true;
  const eng = getEngine();

  setAboutPanel(opts.appName, opts.appNameAr);

  // Menu/tray commands never go to the capture panel.
  setCommandTargetFilter((w) => w !== captureWindow());

  // Quick Capture.
  initQuickCapture({ init: captureInit });
  const sc = applyCaptureShortcut(getSettings().quickCaptureShortcut);
  if (!sc.ok) console.warn(`[zekra] quick capture shortcut ${sc.accelerator} not registered: ${sc.error}`);
  installMenu(); // show the registered shortcut on File ▸ Quick Capture
  if (sc.ok && sc.accelerator) setTimeout(prewarmQuickCapture, 4_000).unref();

  // Dock menu / Jump List, fed by the tray's recent notes.
  initAppShortcuts({ openCapture: () => void showQuickCapture(), showMain: opts.showMainWindow });
  onTrayRecentChanged(setRecentForDock);

  // zekra://app/{capture,new-note,open} and zekra://notification/<action>.
  setDeepLinkInterceptor((e) => handleAppLink(e.host, e.path) || handleNotificationLink(e.host, e.path, e.params));

  // Sync triggers.
  void eng.start();
  app.on("browser-window-focus", (_e, win) => {
    if (win !== captureWindow()) eng.onFocus();
  });
  app.on("browser-window-created", (_e, created) => {
    setTimeout(reapplyOverlay, 500);
    // Windows / Linux quit when the last window closes; the hidden capture
    // panel must not keep the app alive (macOS apps stay in the Dock anyway).
    if (process.platform === "darwin") return;
    created.on("closed", () => {
      const rest = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w !== captureWindow());
      if (!rest.length) destroyCaptureWindow();
    });
  });
  let wasOnline = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now && !wasOnline) eng.onNetworkMaybeBack();
    wasOnline = now;
  }, NET_POLL_MS).unref();

  // Power: pause on sleep, stretch on battery, pause in Low Power Mode /
  // under thermal pressure; resume (and sync) on wake.
  powerMonitor.on("suspend", () => eng.setPaused("suspend"));
  powerMonitor.on("resume", () => {
    if (eng.pausedReason === "suspend") eng.setPaused(null);
  });
  const battery = () => eng.setPowerFactor(powerMonitor.isOnBatteryPower() ? 3 : 1);
  powerMonitor.on("on-battery", battery);
  powerMonitor.on("on-ac", battery);
  battery();
  if (process.platform === "darwin") {
    powerMonitor.on("thermal-state-change", (details: { state?: string } | string) => {
      const state = typeof details === "string" ? details : details?.state;
      if (state === "serious" || state === "critical") eng.setPaused("thermal");
      else if (eng.pausedReason === "thermal") eng.setPaused(null);
    });
    const checkLowPower = async () => {
      const low = await lowPowerMode();
      if (low && !eng.pausedReason) eng.setPaused("low-power");
      else if (!low && eng.pausedReason === "low-power") eng.setPaused(null);
    };
    void checkLowPower();
    setInterval(() => void checkLowPower(), LOW_POWER_POLL_MS).unref();
  }

  // Quit: flush the cache (brain documents are written debounced). will-quit,
  // not before-quit: main.ts's before-quit is still letting the editors save
  // (through this queue) at that point.
  let flushed = false;
  app.on("will-quit", (event) => {
    disposeQuickCapture();
    if (flushed || installingUpdate) return;
    event.preventDefault();
    flushed = true;
    const timeout = new Promise((r) => setTimeout(r, 1_500));
    void Promise.race([eng.stop(), timeout]).finally(() => app.quit());
  });
}

/** main.ts calls this after every settings patch. */
export function servicesOnSettingsChanged(next: AppSettings, patch: SettingsPatch): void {
  if (!installed) return;
  if (
    "authToken" in patch ||
    "authUser" in patch ||
    "apiBaseUrl" in patch ||
    "offlineCacheEnabled" in patch ||
    "syncIntervalMinutes" in patch
  ) {
    void getEngine().onSettingsChanged();
  }
  if ("quickCaptureShortcut" in patch) {
    applyCaptureShortcut(next.quickCaptureShortcut);
    installMenu(); // the File ▸ Quick Capture hint
  }
  if ("launchAtLogin" in patch || "openAtLoginHidden" in patch) {
    void applyLoginItem(next.launchAtLogin, next.openAtLoginHidden).then((r) => {
      if (!r.ok) console.warn("[zekra] login item:", r.message);
    });
  }
  if ("locale" in patch) rebuildAppShortcuts();
}
