// Which windows hold unsaved edits — the updater must never quit over them.
//
// The workspace already reports its dirty state for the macOS "edited" dot
// (bridge().setDocumentEdited -> IPC.windowSetEdited, ipc-handlers.ts), on
// every platform. That handler records it here too, per window, so the
// updater can ask without reaching into the editor. A window that goes away
// takes its flag with it.
"use strict";

import type { BrowserWindow } from "electron";

const edited = new Map<number, boolean>();

export function setWindowEdited(win: BrowserWindow, value: boolean): void {
  const id = win.id;
  if (!edited.has(id)) win.once("closed", () => edited.delete(id));
  edited.set(id, value);
}

export function hasUnsavedEdits(): boolean {
  for (const v of edited.values()) if (v) return true;
  return false;
}
