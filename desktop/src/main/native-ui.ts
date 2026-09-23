// Native shell services for the renderer (channels in src/shared/ipc.ts):
//
//   menuPopup       a native popup menu built from a plain item list — every
//                   right-click / "…" menu in the app; resolves with the
//                   chosen item's id (or null when dismissed)
//   menuPopupApp    the application menu as a popup (the Windows / Linux
//                   title-bar "…" button; macOS has the real menu bar)
//   windowOpenNote  a note in its own document window (Window menu lists it);
//                   open note windows are restored on the next launch
//   windowSetChrome the theme's title-bar colours for Windows' caption overlay
//
// Windows are framed by window-chrome.ts, like the main window.
"use strict";

import { app, BrowserWindow, ipcMain, Menu, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  IPC,
  type NativeMenuItem,
  type NoteWindowRequest,
  type PopupMenuRequest,
  type WindowChromeColors,
  type WindowStateEvent,
} from "../shared/ipc";
import { currentPlatform, TITLEBAR_HEIGHT, windowChromeFor } from "./window-chrome";

/* ------------------------------------------------------------- menus */

function toTemplate(items: NativeMenuItem[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((it): MenuItemConstructorOptions => {
    if (it.type === "separator") return { type: "separator" };
    const base: MenuItemConstructorOptions = {
      label: it.label ?? "",
      enabled: it.enabled !== false,
      accelerator: it.accelerator,
      registerAccelerator: false, // a hint only: the app menu owns shortcuts
    };
    if (it.submenu?.length || it.type === "submenu") {
      return { ...base, submenu: toTemplate(it.submenu ?? [], pick) };
    }
    return {
      ...base,
      type: it.type === "checkbox" || it.type === "radio" ? it.type : "normal",
      checked: it.checked,
      click: () => it.id && pick(it.id),
    };
  });
}

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

function popup(e: IpcMainInvokeEvent, req: PopupMenuRequest): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const menu = Menu.buildFromTemplate(toTemplate(req.items ?? [], (id) => finish(id)));
    const win = senderWindow(e) ?? undefined;
    menu.popup({
      window: win,
      ...(typeof req.x === "number" && typeof req.y === "number" ? { x: Math.round(req.x), y: Math.round(req.y) } : {}),
      // The close callback can run before the item's click; let a click win.
      callback: () => setTimeout(() => finish(null), 50),
    });
  });
}

/* ------------------------------------------------------ note windows */

type Saved = NoteWindowRequest & { bounds?: Electron.Rectangle };
const noteWindows = new Map<string, BrowserWindow>();
/** Note windows (existing and new), for cascading. */
const noteWindowSet = new WeakSet<BrowserWindow>();
let quitting = false;

const storeFile = () => path.join(app.getPath("userData"), "note-windows.json");
const keyOf = (r: NoteWindowRequest) => `${r.namespace}/${r.id}`;

function readSaved(): Saved[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as Saved[]).filter((w) => w && typeof w.namespace === "string" && typeof w.id === "string") : [];
  } catch {
    return [];
  }
}

function writeSaved(): void {
  const list: Saved[] = [];
  for (const [key, win] of noteWindows) {
    if (win.isDestroyed()) continue;
    const [namespace, id] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
    list.push({ namespace, id, title: win.getTitle(), bounds: win.getBounds() });
  }
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}

function sendState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const state: WindowStateEvent = { focused: win.isFocused(), fullscreen: win.isFullScreen(), maximized: win.isMaximized() };
  win.webContents.send(IPC.evWindowState, state);
}

/** Lock a renderer window to the bundled page (same rules as the main window). */
export function guardWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).protocol !== "file:") {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  for (const ev of ["focus", "blur", "enter-full-screen", "leave-full-screen", "maximize", "unmaximize"] as const) {
    win.on(ev as "focus", () => sendState(win));
  }
  win.webContents.on("did-finish-load", () => sendState(win));
}

function noteWindowOptions(bounds?: Electron.Rectangle, title?: string): Electron.BrowserWindowConstructorOptions {
  return {
    ...(bounds ?? { width: 760, height: 820 }),
    minWidth: 480,
    minHeight: 360,
    title: title || "Zekra",
    show: false,
    ...windowChromeFor(currentPlatform()),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  };
}

/** Track `win` under `key` (restored on relaunch) until it closes. */
function trackNoteWindow(win: BrowserWindow, key: string): void {
  noteWindows.set(key, win);
  noteWindowSet.add(win);
  win.on("close", () => writeSavedSoon());
  win.on("closed", () => {
    if (noteWindows.get(key) === win) noteWindows.delete(key);
    if (!quitting) writeSaved();
  });
  win.on("moved", writeSavedSoon);
  win.on("resized", writeSavedSoon);
  win.on("page-title-updated", writeSavedSoon);
  writeSavedSoon();
}

export function openNoteWindow(req: NoteWindowRequest, bounds?: Electron.Rectangle): BrowserWindow {
  const key = keyOf(req);
  const existing = noteWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    if (!existing.isVisible()) existing.show();
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow(noteWindowOptions(bounds, req.title));
  guardWindow(win);
  win.once("ready-to-show", () => win.show());
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
    query: { window: "note", ns: req.namespace, id: req.id },
  });
  trackNoteWindow(win, key);
  return win;
}

/** File ▸ New Note, the tray, the Dock, ⌘N: a new note in its own window,
 *  with a brain picker on top (`namespace` preselects one). It is not
 *  restored on relaunch until its first save created the note
 *  (noteWindowCreated). Cascades from the focused window. */
export function openNewNoteWindow(namespace?: string | null): BrowserWindow {
  const focused = BrowserWindow.getFocusedWindow();
  let bounds: Electron.Rectangle | undefined;
  if (focused && !focused.isDestroyed() && noteWindowSet.has(focused)) {
    const b = focused.getBounds();
    bounds = { x: b.x + 26, y: b.y + 26, width: b.width, height: b.height };
  }
  const win = new BrowserWindow(noteWindowOptions(bounds));
  noteWindowSet.add(win);
  guardWindow(win);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
    query: { window: "note-new", ...(namespace ? { ns: namespace } : {}) },
  });
  win.on("closed", () => noteWindowSet.delete(win));
  return win;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function writeSavedSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSaved, 400);
}

/** Reopen the note windows that were open when the app last quit. */
export function restoreNoteWindows(): void {
  for (const w of readSaved().slice(0, 12)) openNoteWindow(w, w.bounds);
}

/* ------------------------------------------------------------- wiring */

export function registerNativeUiIpc(): void {
  app.on("before-quit", () => {
    quitting = true;
    clearTimeout(saveTimer);
    writeSaved();
  });

  ipcMain.handle(IPC.menuPopup, (e, req: PopupMenuRequest) => popup(e, req));

  ipcMain.handle(IPC.menuPopupApp, (e, x: number, y: number): void => {
    const menu = Menu.getApplicationMenu();
    const win = senderWindow(e);
    if (!menu || !win) return;
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
  });

  ipcMain.handle(IPC.windowOpenNote, (_e, req: NoteWindowRequest): void => {
    if (!req || typeof req.namespace !== "string" || typeof req.id !== "string") return;
    openNoteWindow({ namespace: req.namespace, id: req.id, title: typeof req.title === "string" ? req.title : undefined });
  });

  // A note-new window saved its note: from now on it is that note's window
  // (the Window menu title, restore on relaunch, "open again" focuses it).
  ipcMain.handle(IPC.windowNoteCreated, (e, req: NoteWindowRequest): void => {
    const win = senderWindow(e);
    if (!win || !req || typeof req.namespace !== "string" || typeof req.id !== "string") return;
    const key = keyOf(req);
    if (noteWindows.get(key) === win) return;
    trackNoteWindow(win, key);
  });

  // Windows: caption buttons in the theme's colours. Only #rrggbb[aa] passes.
  ipcMain.handle(IPC.windowSetChrome, (e, colors: WindowChromeColors): void => {
    if (process.platform !== "win32") return;
    const win = senderWindow(e);
    const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
    if (!win || !hex.test(colors?.background ?? "") || !hex.test(colors?.foreground ?? "")) return;
    try {
      win.setTitleBarOverlay({ color: colors.background, symbolColor: colors.foreground, height: TITLEBAR_HEIGHT.win32 });
    } catch {
      /* not an overlay window */
    }
  });
}
