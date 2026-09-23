// Quick Capture: a global shortcut opens a small floating panel over whatever
// the user is doing; ⌘↵ / Ctrl+Enter saves a note through the offline queue
// (so it works with no network), Esc or clicking away dismisses it.
//
// Native per platform:
//   macOS    an NSPanel (`type: "panel"`: floats over full-screen apps and
//            does not pull the app's other windows forward) with the "hud"
//            vibrancy material, on the Space the user is on.
//            Default shortcut ⌥⌘N (Alt+Command+N).
//   Windows  frameless, rounded, acrylic backdrop on Windows 11 (solid on 10),
//            no taskbar button. Default Ctrl+Alt+N (never a Win+ chord: those
//            belong to the shell).
//   Linux    frameless, solid, no taskbar entry. Default Ctrl+Alt+N. Global
//            shortcuts need X11 (or XWayland); under a pure Wayland session
//            the compositor may refuse them — the Dock/tray item still works.
//
// The panel is its own renderer entry (src/renderer/capture/, bundled to
// out/renderer/capture.html + capture.js), created once and re-shown, so it
// appears instantly. It uses the same sandboxed preload and CSP as every
// other window.
"use strict";

import { app, BrowserWindow, clipboard, globalShortcut, nativeTheme, screen, type BrowserWindowConstructorOptions } from "electron";
import * as path from "node:path";

import type { BrowserTabResult, CaptureInit, ClipboardCapture, ShortcutResult } from "../shared/ipc";
import { IPC } from "../shared/ipc";
import { activeBrowserTab, frontmostBundleId } from "./browser-tab";
import { currentPlatform, isWindows11 } from "./window-chrome";

export const CAPTURE_SIZE = { width: 600, height: 400 };

export function defaultCaptureShortcut(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? "Alt+Command+N" : "Control+Alt+N";
}

/** "Alt+Command+N" -> "⌥⌘N" on macOS, "Ctrl+Alt+N" elsewhere. */
export function displayAccelerator(accel: string, platform: NodeJS.Platform = process.platform): string {
  if (!accel) return "";
  const parts = accel.split("+");
  if (platform === "darwin") {
    const map: Record<string, string> = {
      Command: "⌘", Cmd: "⌘", CommandOrControl: "⌘", CmdOrCtrl: "⌘", Control: "⌃", Ctrl: "⌃",
      Alt: "⌥", Option: "⌥", Shift: "⇧", Super: "⌘", Meta: "⌘", Space: "Space",
    };
    const order = ["⌃", "⌥", "⇧", "⌘"];
    const mods = parts.slice(0, -1).map((p) => map[p] ?? p).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return mods.join("") + (map[parts[parts.length - 1]] ?? parts[parts.length - 1]);
  }
  const map: Record<string, string> = { Control: "Ctrl", CommandOrControl: "Ctrl", CmdOrCtrl: "Ctrl", Command: "Win", Super: "Win", Meta: "Win" };
  return parts.map((p) => map[p] ?? p).join("+");
}

const MODIFIERS = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "AltGr", "Shift", "Super", "Meta"]);

/** A usable global accelerator: 1+ modifiers (not Shift alone) + one key, and
 *  no Super/Win on Windows (reserved by the shell). */
export function validAccelerator(accel: string, platform: NodeJS.Platform = process.platform): boolean {
  const parts = accel.split("+").filter(Boolean);
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (MODIFIERS.has(key) || !mods.every((m) => MODIFIERS.has(m))) return false;
  if (mods.every((m) => m === "Shift")) return false;
  if (platform === "win32" && mods.some((m) => m === "Super" || m === "Meta" || m === "Command" || m === "Cmd")) return false;
  return /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Enter|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Insert|[`\-=[\]\\;',./])$/i.test(key);
}

/* ---------------------------------------------------------------- state */

let win: BrowserWindow | null = null;
let registered = "";
let shortcutError: ShortcutResult["error"] | undefined;
/** Frontmost app when the shortcut fired (macOS), for "From browser". */
let frontBundle: string | null = null;
let buildInit: () => Promise<CaptureInit> = async () => {
  throw new Error("quick capture not initialised");
};

export function initQuickCapture(opts: { init: () => Promise<CaptureInit> }): void {
  buildInit = opts.init;
}

export function captureWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/* ---------------------------------------------------------------- window */

function chrome(): BrowserWindowConstructorOptions {
  const p = currentPlatform();
  if (p === "darwin") {
    return {
      type: "panel",
      vibrancy: "hud",
      visualEffectState: "active",
      backgroundColor: "#00000000",
      roundedCorners: true,
    };
  }
  if (p === "win32") {
    // A hidden title bar rather than frame:false keeps the DWM border, the
    // Windows 11 corner rounding and the acrylic material working.
    return isWindows11()
      ? { frame: true, titleBarStyle: "hidden", backgroundMaterial: "acrylic", backgroundColor: "#00000000", roundedCorners: true }
      : { frame: true, titleBarStyle: "hidden", backgroundColor: nativeTheme.shouldUseDarkColors ? "#0B1429" : "#F0EBE1" };
  }
  return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#0B1429" : "#F0EBE1" };
}

function create(): BrowserWindow {
  const w = new BrowserWindow({
    ...CAPTURE_SIZE,
    minWidth: 420,
    minHeight: 300,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    title: "Quick Capture",
    ...chrome(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (process.platform === "darwin") {
    w.setAlwaysOnTop(true, "floating");
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  } else {
    w.setAlwaysOnTop(true, "pop-up-menu");
  }
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  // Clicking away dismisses, like Spotlight. (DevTools would steal focus in dev.)
  w.on("blur", () => {
    if (!w.webContents.isDevToolsOpened()) hideQuickCapture();
  });
  w.on("closed", () => {
    if (win === w) win = null;
  });
  void w.loadFile(path.join(__dirname, "..", "renderer", "capture.html"));
  return w;
}

/** Centre on the display under the pointer, a little above the middle. */
function place(w: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const [width, height] = w.getSize();
  w.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + Math.max(24, (area.height - height) * 0.32)),
    width,
    height,
  });
}

export async function showQuickCapture(prefill?: CaptureInit["prefill"]): Promise<void> {
  if (!app.isReady()) return;
  const w = captureWindow() ?? (win = create());
  if (w.isVisible() && !prefill) {
    hideQuickCapture();
    return;
  }
  // Must run BEFORE the panel takes focus: afterwards Zekra is frontmost.
  frontBundle = await frontmostBundleId().catch(() => null);
  const init = { ...(await buildInit()), ...(prefill ? { prefill } : {}) };
  place(w);
  const reveal = () => {
    w.webContents.send(IPC.evCaptureShow, init);
    w.show();
    w.focus();
  };
  if (w.webContents.isLoading()) w.webContents.once("did-finish-load", reveal);
  else reveal();
}

/** Create the (hidden) panel ahead of time so the first shortcut press shows
 *  it instantly instead of waiting for the page to load. */
export function prewarmQuickCapture(): void {
  if (app.isReady() && !captureWindow()) win = create();
}

export function hideQuickCapture(): void {
  const w = captureWindow();
  if (!w || !w.isVisible()) return;
  w.hide();
}

export async function captureClipboard(): Promise<ClipboardCapture> {
  const text = clipboard.readText().trim();
  const url = /^https?:\/\/\S+$/i.test(text) ? text : undefined;
  return { text, url };
}

export async function captureBrowserTab(): Promise<BrowserTabResult> {
  return activeBrowserTab(frontBundle);
}

/* ------------------------------------------------------------- shortcut */

/** (Re-)register the global shortcut. `accel` null = platform default, "" = off. */
export function applyCaptureShortcut(accel: string | null): ShortcutResult {
  const want = accel === null ? defaultCaptureShortcut() : accel.trim();
  if (registered) {
    globalShortcut.unregister(registered);
    registered = "";
  }
  shortcutError = undefined;
  if (!want) return { ok: true, accelerator: "" };
  if (!validAccelerator(want)) {
    shortcutError = "invalid";
    return { ok: false, accelerator: want, error: "invalid" };
  }
  let ok = false;
  try {
    ok = globalShortcut.register(want, () => void showQuickCapture());
  } catch {
    shortcutError = "invalid";
    return { ok: false, accelerator: want, error: "invalid" };
  }
  if (!ok) {
    // Another app owns it (or, on Wayland, the compositor refused).
    shortcutError = "in-use";
    return { ok: false, accelerator: want, error: "in-use" };
  }
  registered = want;
  return { ok: true, accelerator: want };
}

export function captureShortcutState(): { accelerator: string; registered: boolean; error?: ShortcutResult["error"] } {
  return { accelerator: registered, registered: Boolean(registered), error: shortcutError };
}

/** Destroy the panel window but keep the shortcut (it re-creates on demand). */
export function destroyCaptureWindow(): void {
  captureWindow()?.destroy();
  win = null;
}

export function disposeQuickCapture(): void {
  if (registered) globalShortcut.unregister(registered);
  registered = "";
  captureWindow()?.destroy();
  win = null;
}
