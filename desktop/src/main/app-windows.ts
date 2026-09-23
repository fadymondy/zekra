// The app's auxiliary windows — the Health Debug window architecture
// (healthdebug/desktop/src/windows.ts): every surface is its own native
// window loading the SAME bundled renderer, picked by `?window=`:
//
//   settings   Settings… (⌘,): single instance, a normal titled window with
//              toolbar-style section tabs; remembers its frame; zekra://
//              settings/<section> and every "Settings" item open it here.
//   spotlight  ⌘K / the tray / an optional global shortcut: a frameless
//              floating panel (macOS NSPanel + vibrancy, Windows 11 acrylic),
//              centred near the top of the display under the pointer. It is
//              built ahead of time and re-shown, hides on Esc and on blur, and
//              sizes itself to its results (resizeSelf). Picking a result hides
//              it and focuses the main window at that place (openInMain).
//   new-brain  File ▸ New Brain, the sidebar "+", the tray: a small fixed
//              window with the create form.
//
// New Note windows are note windows (native-ui.ts openNewNoteWindow).
"use strict";

import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen, type BrowserWindowConstructorOptions } from "electron";
import * as path from "node:path";

import { IPC, SETTINGS_SECTIONS, type SettingsSectionId, type ShortcutResult } from "../shared/ipc";
import { captureWindow, destroyCaptureWindow, validAccelerator } from "./quick-capture";
import { broadcast } from "./renderer-events";
import { getAuxBounds, getSettings, patchSettings, setAuxBounds } from "./settings-store";
import { guardWindow } from "./native-ui";
import { currentPlatform, isWindows11, windowChromeFor } from "./window-chrome";
import { visibleOnSomeDisplay } from "./window-state";
import { ws } from "./window-strings";

type Kind = "settings" | "spotlight" | "new-brain";

const windows = new Map<Kind, BrowserWindow>();
/** When a transient window (Spotlight) was last shown — see its blur handler. */
const shownAt = new WeakMap<BrowserWindow, number>();

function get(kind: Kind): BrowserWindow | null {
  const w = windows.get(kind);
  return w && !w.isDestroyed() ? w : null;
}

/** Which app window a web contents is (IPC uses this for hide/resize). */
export function appWindowKindOf(wc: Electron.WebContents): Kind | null {
  for (const [k, w] of windows) if (!w.isDestroyed() && w.webContents === wc) return k;
  return null;
}

export function spotlightWindow(): BrowserWindow | null {
  return get("spotlight");
}

function prefs(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: true,
  };
}

function load(win: BrowserWindow, query: Record<string, string>): void {
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { query });
}

const solidGround = () => (nativeTheme.shouldUseDarkColors ? "#0B1429" : "#F0EBE1");

/* ------------------------------------------------------------ settings */

const SETTINGS_SIZE = { width: 780, height: 640 };
const SETTINGS_MIN = { width: 700, height: 460 };

function isSection(v: unknown): v is SettingsSectionId {
  return typeof v === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(v);
}

export function showSettingsWindow(section?: string | null): BrowserWindow {
  const target = isSection(section) ? section : undefined;
  const existing = get("settings");
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    if (target) existing.webContents.send(IPC.evSettingsSection, target);
    return existing;
  }

  const saved = getAuxBounds("settings");
  const frame =
    saved && saved.x !== undefined && saved.y !== undefined && visibleOnSomeDisplay({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
      ? { x: saved.x, y: saved.y, width: Math.max(SETTINGS_MIN.width, saved.width), height: Math.max(SETTINGS_MIN.height, saved.height) }
      : { width: saved?.width ?? SETTINGS_SIZE.width, height: saved?.height ?? SETTINGS_SIZE.height };

  const p = currentPlatform();
  const chrome = windowChromeFor(p);
  const w = new BrowserWindow({
    ...frame,
    minWidth: SETTINGS_MIN.width,
    minHeight: SETTINGS_MIN.height,
    show: false,
    title: ws().settingsTitle,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    ...chrome,
    // The toolbar row under the traffic lights (macOS): lights in the title row.
    ...(p === "darwin" ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
    webPreferences: prefs(),
  });
  windows.set("settings", w);
  guardWindow(w);
  w.once("ready-to-show", () => w.show());
  // The renderer names its section in document.title; the OS title stays "Settings".
  w.on("page-title-updated", (e) => e.preventDefault());

  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (w.isDestroyed()) return;
    const b = w.getBounds();
    setAuxBounds("settings", { x: b.x, y: b.y, width: b.width, height: b.height, maximized: false });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  w.on("resize", schedule);
  w.on("move", schedule);
  w.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
  w.on("closed", () => windows.delete("settings"));

  load(w, { window: "settings", ...(target ? { section: target } : {}) });
  return w;
}

/* ----------------------------------------------------------- spotlight */

const SPOTLIGHT = { width: 680, height: 420, min: 118, max: 560 };

function spotlightChrome(): BrowserWindowConstructorOptions {
  const p = currentPlatform();
  if (p === "darwin") {
    // An NSPanel: floats over full-screen apps and takes the keyboard without
    // pulling Zekra's other windows forward (Spotlight's own behaviour).
    return { type: "panel", vibrancy: "popover", visualEffectState: "active", backgroundColor: "#00000000", roundedCorners: true };
  }
  if (p === "win32") {
    // A hidden title bar rather than frame:false keeps the DWM border, the
    // Windows 11 rounding and the acrylic material (as Quick Capture does).
    return isWindows11()
      ? { frame: true, titleBarStyle: "hidden", backgroundMaterial: "acrylic", backgroundColor: "#00000000", roundedCorners: true }
      : { frame: true, titleBarStyle: "hidden", backgroundColor: solidGround() };
  }
  return { backgroundColor: solidGround() };
}

function createSpotlight(): BrowserWindow {
  const w = new BrowserWindow({
    width: SPOTLIGHT.width,
    height: SPOTLIGHT.height,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    title: ws().spotlightTitle,
    ...spotlightChrome(),
    webPreferences: prefs(),
  });
  windows.set("spotlight", w);
  if (process.platform === "darwin") w.setAlwaysOnTop(true, "floating");
  else w.setAlwaysOnTop(true, "pop-up-menu");
  w.setMenuBarVisibility(false);
  guardWindow(w);
  // Clicking elsewhere dismisses it — not in the first moments after it opened
  // (activation can bounce focus once), and never while DevTools has focus.
  w.on("blur", () => {
    if (!w.webContents.isDevToolsOpened() && Date.now() - (shownAt.get(w) ?? 0) > 300) w.hide();
  });
  w.on("closed", () => windows.delete("spotlight"));
  load(w, { window: "spotlight" });
  return w;
}

function placeAndShowSpotlight(w: BrowserWindow): void {
  // The display the person is looking at: the one under the pointer.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [width, height] = w.getSize();
  w.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + area.height * 0.16), width, height }, false);
  if (process.platform === "darwin") w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  shownAt.set(w, Date.now());
  w.show();
  w.focus();
  w.webContents.send(IPC.evWindowShown);
}

export function showSpotlight(): void {
  if (!app.isReady()) return;
  const existing = get("spotlight");
  if (existing) {
    if (existing.isVisible() && existing.isFocused()) {
      existing.hide(); // ⌘K again closes it, like Spotlight
      return;
    }
    if (existing.webContents.isLoading()) existing.webContents.once("did-finish-load", () => placeAndShowSpotlight(existing));
    else placeAndShowSpotlight(existing);
    return;
  }
  const w = createSpotlight();
  w.webContents.once("did-finish-load", () => placeAndShowSpotlight(w));
}

export function hideSpotlight(): void {
  const w = get("spotlight");
  if (w?.isVisible()) w.hide();
}

/** Build the panel early, hidden, so the first ⌘K opens it instantly. */
export function prewarmSpotlight(): void {
  if (app.isReady() && !get("spotlight")) createSpotlight();
}

/** Resize the calling panel to its content (CSS px → screen points). */
export function resizeSpotlight(wc: Electron.WebContents, height: number): void {
  const w = get("spotlight");
  if (!w || w.webContents !== wc) return;
  const h = Math.round(Math.min(Math.max(height * wc.getZoomFactor(), SPOTLIGHT.min), SPOTLIGHT.max));
  const b = w.getBounds();
  if (b.height !== h) w.setBounds({ x: b.x, y: b.y, width: b.width, height: h }, false);
}

/* ------------------------------------------------------ spotlight hotkey */

let spotlightAccel = "";

/** (Re-)register the global Spotlight shortcut. "" = off. */
export function applySpotlightShortcut(accel: string): ShortcutResult {
  const want = String(accel ?? "").trim();
  if (spotlightAccel) {
    globalShortcut.unregister(spotlightAccel);
    spotlightAccel = "";
  }
  if (!want) return { ok: true, accelerator: "" };
  if (!validAccelerator(want)) return { ok: false, accelerator: want, error: "invalid" };
  let ok = false;
  try {
    ok = globalShortcut.register(want, () => showSpotlight());
  } catch {
    return { ok: false, accelerator: want, error: "invalid" };
  }
  if (!ok) return { ok: false, accelerator: want, error: "in-use" };
  spotlightAccel = want;
  return { ok: true, accelerator: want };
}

/* ----------------------------------------------------------- new brain */

export function showNewBrainWindow(): BrowserWindow {
  const existing = get("new-brain");
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  const p = currentPlatform();
  const w = new BrowserWindow({
    width: 520,
    height: 600,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: ws().newBrainTitle,
    ...windowChromeFor(p),
    ...(p === "darwin" ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: prefs(),
  });
  // Centred over the window the person is in.
  const parent = BrowserWindow.getFocusedWindow();
  if (parent && !parent.isDestroyed() && parent !== w) {
    const pb = parent.getBounds();
    w.setPosition(Math.round(pb.x + (pb.width - 520) / 2), Math.round(pb.y + Math.max(40, (pb.height - 600) / 3)), false);
  } else {
    w.center();
  }
  windows.set("new-brain", w);
  guardWindow(w);
  w.on("page-title-updated", (e) => e.preventDefault());
  w.once("ready-to-show", () => {
    w.show();
    w.focus();
  });
  w.on("closed", () => windows.delete("new-brain"));
  load(w, { window: "new-brain" });
  return w;
}

/* --------------------------------------------------------------- misc */

/** Window titles follow the app language. */
export function retitleAppWindows(): void {
  get("settings")?.setTitle(ws().settingsTitle);
  get("new-brain")?.setTitle(ws().newBrainTitle);
  get("spotlight")?.setTitle(ws().spotlightTitle);
}

/**
 * Windows / Linux quit when the last window closes: the hidden Spotlight
 * panel (like the Quick Capture panel) must not keep the app alive.
 */
export function watchLastWindow(): void {
  if (process.platform === "darwin") return;
  app.on("browser-window-created", (_e, created) => {
    created.on("closed", () => {
      const aux = new Set([get("spotlight"), captureWindow()]);
      const rest = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !aux.has(w));
      if (!rest.length) {
        get("spotlight")?.destroy();
        destroyCaptureWindow();
      }
    });
  });
}

/* ---------------------------------------------------------------- IPC */

export function registerAppWindowsIpc(deps: {
  openNewNote: (namespace?: string | null) => void;
  openInMain: (route: string) => void;
}): void {
  ipcMain.handle(IPC.windowOpenSettings, (_e, section?: unknown) => {
    hideSpotlight();
    showSettingsWindow(isSection(section) ? section : undefined);
  });
  ipcMain.handle(IPC.windowOpenSpotlight, () => showSpotlight());
  ipcMain.handle(IPC.windowOpenNewBrain, () => {
    hideSpotlight();
    showNewBrainWindow();
  });
  ipcMain.handle(IPC.windowOpenNewNote, (_e, ns?: unknown) => {
    hideSpotlight();
    deps.openNewNote(typeof ns === "string" && ns ? ns : null);
  });
  ipcMain.handle(IPC.windowOpenInMain, (_e, route: unknown) => {
    if (typeof route !== "string" || route.length > 500) return;
    hideSpotlight();
    deps.openInMain(route);
  });
  ipcMain.handle(IPC.windowHideSelf, (e) => {
    const kind = appWindowKindOf(e.sender);
    if (kind === "spotlight") hideSpotlight();
    else BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle(IPC.windowResizeSelf, (e, height: unknown) => {
    if (typeof height === "number" && Number.isFinite(height)) resizeSpotlight(e.sender, height);
  });
  ipcMain.handle(IPC.windowSetSpotlightShortcut, (_e, accel: unknown): ShortcutResult => {
    const res = applySpotlightShortcut(typeof accel === "string" ? accel : "");
    // Persist what was asked for only when it works (or is "off").
    if (res.ok) broadcast(IPC.evSettingsChanged, patchSettings({ spotlightShortcut: res.accelerator }));
    else applySpotlightShortcut(getSettings().spotlightShortcut ?? ""); // keep the previous one
    return res;
  });
}
