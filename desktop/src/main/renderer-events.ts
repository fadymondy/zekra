// main -> renderer delivery for the typed events in src/shared/ipc.ts.
//
// Commands (menu/tray) go to the focused window straight away — a command
// while the renderer is still booting is meaningless, so it is dropped.
//
// Deep links, opened files and notification clicks are DATA the user expects
// to land somewhere even if they arrived before the window finished loading
// (the most common case: double-clicking a .md file launches the app). Those
// are buffered until the renderer calls `window.zekra.rendererReady()`, and
// the buffer is re-armed whenever the page reloads.
"use strict";

import { BrowserWindow } from "electron";

import {
  IPC,
  type CommandEvent,
  type CommandName,
  type DeepLinkEvent,
  type NotificationClickEvent,
  type OpenFileEvent,
} from "../shared/ipc";

type Buffered =
  | { channel: typeof IPC.evDeepLink; payload: DeepLinkEvent }
  | { channel: typeof IPC.evOpenFile; payload: OpenFileEvent }
  | { channel: typeof IPC.evNotificationClick; payload: NotificationClickEvent }
  // MH-450 tray: commands that must survive a closed window (sendCommandWhenReady).
  | { channel: typeof IPC.evCommand; payload: CommandEvent };

let mainWindow: BrowserWindow | null = null;
let ready = false;
const queue: Buffered[] = [];

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
  ready = false;
  if (!win) return;
  // A reload (or a crash + reload) re-creates the listeners; wait for the
  // renderer to say it is ready again.
  win.webContents.on("did-start-loading", () => {
    ready = false;
  });
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && mainWindow.isDestroyed()) mainWindow = null;
  return mainWindow;
}

export function markRendererReady(): void {
  ready = true;
  flush();
}

function flush(): void {
  const win = getMainWindow();
  if (!win || !ready) return;
  while (queue.length) {
    const item = queue.shift()!;
    win.webContents.send(item.channel, item.payload);
  }
}

function enqueue(item: Buffered): void {
  queue.push(item);
  flush();
}

/** Bring the main window forward (restore if minimised, show if hidden). */
export function focusMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/** Windows that must never receive menu commands (the Quick Capture panel). */
let commandTarget: (win: BrowserWindow) => boolean = () => true;
export function setCommandTargetFilter(fn: (win: BrowserWindow) => boolean): void {
  commandTarget = fn;
}

export function sendCommand(name: CommandName, source: CommandEvent["source"] = "menu"): void {
  const focused = BrowserWindow.getFocusedWindow();
  const win = focused && commandTarget(focused) ? focused : getMainWindow();
  if (!win || win.isDestroyed()) return;
  const event: CommandEvent = { name, source };
  win.webContents.send(IPC.evCommand, event);
}

/**
 * MH-450 (tray): like sendCommand, but QUEUED until the renderer is ready
 * instead of dropped — "New Note" from the menubar while the window is closed
 * creates the window and must still land once it has loaded.
 */
export function sendCommandWhenReady(name: CommandName, source: CommandEvent["source"] = "tray"): void {
  enqueue({ channel: IPC.evCommand, payload: { name, source } });
}

/**
 * Go to a compact route in the main window (router routeFromString syntax),
 * queued until its renderer is ready. "notifications" opens the bell popover.
 * The caller shows / creates the main window first.
 */
export function sendRouteToMain(route: string): void {
  if (route === "notifications") sendCommandWhenReady("go:inbox", "tray");
  else sendNotificationClick({ route });
}

export function sendDeepLink(e: DeepLinkEvent): void {
  enqueue({ channel: IPC.evDeepLink, payload: e });
}

export function sendOpenFile(e: OpenFileEvent): void {
  enqueue({ channel: IPC.evOpenFile, payload: e });
}

export function sendNotificationClick(e: NotificationClickEvent): void {
  enqueue({ channel: IPC.evNotificationClick, payload: e });
}

/** Broadcast to every window (theme, update state, window state). */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
