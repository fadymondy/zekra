// MH-450 app lock: tells the renderer when Zekra leaves / returns to the
// foreground and when the Mac locks or sleeps, so the Touch ID lock
// (src/renderer/features/security) can decide whether to lock again.
//
// App-level activation is used rather than window blur: the app's own sheets
// (save dialogs, confirms) blur the window but do not make the app inactive.
"use strict";

import { app, powerMonitor, type BrowserWindow } from "electron";

import { IPC, type AppActivityEvent } from "../shared/ipc";
import { broadcast } from "./renderer-events";

function send(state: AppActivityEvent["state"]): void {
  broadcast(IPC.evAppActivity, { state } satisfies AppActivityEvent);
}

let installed = false;

/** Call once, after app "ready". */
export function installAppActivity(): void {
  if (installed) return;
  installed = true;
  app.on("did-resign-active", () => send("background"));
  app.on("did-become-active", () => send("active"));
  app.on("browser-window-created", (_e, win: BrowserWindow) => {
    win.on("minimize", () => send("background"));
    win.on("hide", () => send("background"));
    win.on("restore", () => send("active"));
    win.on("show", () => send("active"));
  });
  powerMonitor.on("lock-screen", () => send("system-lock"));
  powerMonitor.on("suspend", () => send("system-lock"));
}
