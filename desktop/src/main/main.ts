// Zekra desktop — Electron main process entry.
//
// A native client of the Zekra brain/notes REST API, not a browser wrapper:
// the only page ever loaded into the window is this app's own bundled renderer
// (out/renderer/index.html). Backend calls happen in main (api-proxy.ts)
// because a file:// renderer sends Origin: null, which the API rejects (MH-269).
//
// Module map:
//   main.ts            lifecycle, single-instance lock, the main window
//   ipc-handlers.ts    every ipcMain.handle (channels in src/shared/ipc.ts)
//   renderer-events.ts main -> renderer events + the pre-ready buffer
//   menu.ts            native menu (EN/AR) -> typed command bus
//   deep-links.ts      zekra:// + open-file (.md/.markdown/.mdx)
//   window-state.ts    persisted window bounds
//   settings-store.ts  electron-store + safeStorage-encrypted token
//   tray.ts            menubar item
//   updater.ts         electron-updater (GitHub fadymondy/zekra)
//   security.ts        CSP header + permission policy
"use strict";

import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import * as path from "node:path";

import { IPC, type AppSettings, type WindowStateEvent } from "../shared/ipc";
import { handleArgv, installEarlyOpenHandlers, registerProtocol } from "./deep-links";
import { installAppActivity } from "./app-activity"; // MH-450 app lock
import { ensureNativeLanguageAtLaunch, nativeLanguageChanged } from "./app-language";
import { applyThemeSource, registerIpc } from "./ipc-handlers";
import { APP_NAME, APP_NAME_AR, installMenu } from "./menu";
import { setMenuLocale } from "./menu-strings";
import { broadcast, focusMainWindow, getMainWindow, setMainWindow } from "./renderer-events";
import { hardenSession } from "./security";
import { getSettings, migrateSettings } from "./settings-store";
import { createTray, rebuildTrayMenu } from "./tray";
import { consumeHiddenRelaunch, installingUpdate, startUpdater, updaterOnSettingsChanged } from "./updater";
import { initialBounds, MIN_SIZE, trackWindowState } from "./window-state";
import { windowBackgroundFor, windowChromeFor } from "./window-chrome";
import { openNewNoteWindow, registerNativeUiIpc, restoreNoteWindows } from "./native-ui";
import { applySpotlightShortcut, prewarmSpotlight, registerAppWindowsIpc, retitleAppWindows, watchLastWindow } from "./app-windows";
import { sendRouteToMain } from "./renderer-events";
import { installDesktopServices, servicesOnSettingsChanged, startHidden } from "./services";

const APP_ID = "com.fadymondy.zekra.desktop";

/* ----------------------------------------------------- single instance */

// A second launch (Dock, `open zekra://…` on Windows/Linux, double-clicking a
// .md file) hands its argv to this instance and quits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

function boot(): void {
  app.setAppUserModelId(APP_ID);
  app.setName(APP_NAME);

  // Must be synchronous, before "ready": macOS fires open-file / open-url for
  // the launching document before the app is ready.
  installEarlyOpenHandlers();
  registerProtocol();

  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    handleArgv(argv);
  });

  app.whenReady().then(onReady).catch((err) => {
    console.error("[zekra] startup failed", err);
  });

  // Quitting waits (briefly) for open notes to finish saving: the editor's
  // autosave may still have a change in flight. Skipped when quitting to
  // install an update, which must not be delayed or interrupted.
  let quitFlushed = false;
  app.on("before-quit", (event) => {
    if (quitFlushed || installingUpdate) return;
    // Every renderer window (main + note windows) may hold an unsaved edit.
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (!wins.length) return;
    event.preventDefault();
    quitFlushed = true;
    const flushed = Promise.all(
      wins.map((w) =>
        w.webContents.executeJavaScript("window.__zekraFlushAll ? window.__zekraFlushAll() : null", true).catch(() => undefined),
      ),
    );
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    void Promise.race([flushed, timeout]).finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    // macOS apps stay alive in the Dock / menubar.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (!getMainWindow()) createMainWindow();
    else focusMainWindow();
  });

  nativeTheme.on("updated", () => {
    broadcast(IPC.evSystemTheme, nativeTheme.shouldUseDarkColors);
    const win = getMainWindow();
    if (win) win.setBackgroundColor(backgroundFor());
  });

  process.on("uncaughtException", (err) => {
    console.error("[zekra] uncaught exception:", err);
    if (app.isReady() && !app.isPackaged) {
      void dialog.showMessageBox({ type: "error", title: `${APP_NAME} — unexpected error`, message: err.message });
    }
  });
}

/* ------------------------------------------------------------- ready */

/** Consumed by the first main window (services.ts startHidden). */
let hiddenLaunch = false;

function onReady(): void {
  migrateSettings();
  // macOS menus take their direction (RTL for Arabic) from the app language
  // at launch — relaunch now, before any window, if it doesn't match.
  if (ensureNativeLanguageAtLaunch(getSettings().locale)) return;
  // An unattended update install relaunches hidden if no window was open.
  hiddenLaunch = consumeHiddenRelaunch() || startHidden();
  const settings = getSettings();
  setMenuLocale(settings.locale);
  applyThemeSource(settings.theme);
  hardenSession();

  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: `© ${new Date().getFullYear()} ${APP_NAME} (${APP_NAME_AR})`,
      website: "https://zekra.dev",
    });
  }

  registerIpc(onSettingsChanged);
  registerNativeUiIpc(); // native popup menus, note windows, title-bar colours
  // Settings, Spotlight, New Brain, New Note windows (app-windows.ts).
  registerAppWindowsIpc({
    openNewNote: (ns) => void openNewNoteWindow(ns ?? getSettings().activeBrain),
    openInMain: (route) => {
      showMain();
      sendRouteToMain(route);
    },
  });
  watchLastWindow();
  installAppActivity(); // MH-450 app lock: before the main window exists
  installMenu();
  createMainWindow();
  restoreNoteWindows(); // note windows open at last quit
  createTray(() => {
    if (!getMainWindow()) createMainWindow();
    focusMainWindow();
  });
  startUpdater();
  // Spotlight: its optional global shortcut, and the panel built ahead of time
  // (hidden) so ⌘K shows it instantly.
  const spot = applySpotlightShortcut(settings.spotlightShortcut ?? "");
  if (!spot.ok) console.warn(`[zekra] spotlight shortcut ${spot.accelerator} not registered: ${spot.error}`);
  setTimeout(prewarmSpotlight, 2_500).unref?.();
  // Offline cache + sync, Quick Capture, login item, Dock menu / Jump List,
  // share, rich notifications (services.ts). Before handleArgv: it claims
  // zekra://app/… links (Jump List tasks).
  installDesktopServices({
    showMainWindow: () => {
      if (!getMainWindow()) createMainWindow();
      focusMainWindow();
    },
    appName: APP_NAME,
    appNameAr: APP_NAME_AR,
  });

  // Windows / Linux deliver the launch URL or file in argv.
  if (process.platform !== "darwin") handleArgv(process.argv);
}

function onSettingsChanged(next: AppSettings, patch: Partial<AppSettings>): void {
  if (patch.locale) {
    setMenuLocale(next.locale);
    installMenu();
    rebuildTrayMenu();
    retitleAppWindows();
    nativeLanguageChanged(next.locale); // relaunches on macOS: menus take the new direction
  }
  if (patch.theme) {
    applyThemeSource(next.theme);
    getMainWindow()?.setBackgroundColor(backgroundFor());
  }
  servicesOnSettingsChanged(next, patch); // shortcut, login item, sync scope/interval
  updaterOnSettingsChanged(patch); // update channel, auto-install
}

/** Show (creating if needed) and focus the main window. */
function showMain(): void {
  if (!getMainWindow()) createMainWindow();
  focusMainWindow();
}

/* ------------------------------------------------------------ window */

/** The window's own ground — transparent where a system material (vibrancy,
 *  Mica) shows through, else the Zekra ground for the resolved theme, painted
 *  before the first frame so there is no white flash (window-chrome.ts). */
function backgroundFor(): string {
  return windowBackgroundFor();
}

function rendererIndexPath(): string {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function sendWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const state: WindowStateEvent = {
    focused: win.isFocused(),
    fullscreen: win.isFullScreen(),
    maximized: win.isMaximized(),
  };
  win.webContents.send(IPC.evWindowState, state);
}

function createMainWindow(): BrowserWindow {
  const bounds = initialBounds();

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: APP_NAME,
    show: false,
    // Native chrome per OS (window-chrome.ts): macOS hiddenInset + traffic
    // lights over the renderer's unified toolbar + sidebar vibrancy; Windows
    // caption-button overlay + Mica; Linux the WM's own frame.
    ...windowChromeFor(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  setMainWindow(win);
  trackWindowState(win);
  if (bounds.maximized) win.maximize();
  if (bounds.fullscreen) win.setFullScreen(true);

  // Launched at login with "open hidden": menubar/tray only until the user
  // opens it (Dock click -> activate, tray -> Open Zekra).
  win.once("ready-to-show", () => {
    if (hiddenLaunch) hiddenLaunch = false;
    else win.show();
  });

  // Only ever load this app's own bundled renderer. No remote loadURL.
  void win.loadFile(rendererIndexPath());

  win.webContents.on("did-finish-load", () => {
    console.log("[zekra] renderer loaded");
    sendWindowState(win);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[zekra] renderer gone:", details.reason);
  });

  // target=_blank / window.open go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Never navigate away from the bundled renderer.
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).protocol !== "file:") {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  for (const ev of ["focus", "blur", "enter-full-screen", "leave-full-screen", "maximize", "unmaximize"] as const) {
    win.on(ev as "focus", () => sendWindowState(win));
  }

  win.on("closed", () => setMainWindow(null));

  return win;
}
