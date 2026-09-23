// Main-window geometry: restored on launch, persisted (debounced) as the user
// moves / resizes / maximises it. Bounds that no longer fit any attached
// display (an unplugged monitor) are discarded rather than opening the window
// off-screen.
"use strict";

import { BrowserWindow, screen, type Rectangle } from "electron";

import type { WindowBounds } from "../shared/ipc";
import { getWindowBounds, setWindowBounds } from "./settings-store";

export const DEFAULT_SIZE = { width: 1280, height: 840 };
export const MIN_SIZE = { width: 900, height: 580 };

export function visibleOnSomeDisplay(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: d }) => {
    // At least a 120x80 strip of the title bar must be on screen.
    const ix = Math.max(0, Math.min(b.x + b.width, d.x + d.width) - Math.max(b.x, d.x));
    const iy = Math.max(0, Math.min(b.y + 80, d.y + d.height) - Math.max(b.y, d.y));
    return ix >= 120 && iy >= 40;
  });
}

/** The saved geometry, or a sane default. */
export function initialBounds(): WindowBounds {
  const saved = getWindowBounds();
  if (!saved) return { ...DEFAULT_SIZE, maximized: false };
  const width = Math.max(MIN_SIZE.width, saved.width || DEFAULT_SIZE.width);
  const height = Math.max(MIN_SIZE.height, saved.height || DEFAULT_SIZE.height);
  if (saved.x === undefined || saved.y === undefined) return { width, height, maximized: saved.maximized };
  const rect = { x: saved.x, y: saved.y, width, height };
  if (!visibleOnSomeDisplay(rect)) return { width, height, maximized: saved.maximized };
  return { ...rect, maximized: saved.maximized, fullscreen: saved.fullscreen };
}

/** Persist geometry changes of `win` from now on. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const fullscreen = win.isFullScreen();
    // Keep the NORMAL bounds while maximised/fullscreen, so un-maximising on
    // the next launch returns to the size the user actually chose.
    const b = maximized || fullscreen ? win.getNormalBounds() : win.getBounds();
    setWindowBounds({ x: b.x, y: b.y, width: b.width, height: b.height, maximized, fullscreen });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) {
    win.on(ev as "resize", schedule);
  }
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
