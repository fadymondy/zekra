// ipcMain handlers for the MH-450 Mark It Down features, registered from
// ipc-handlers.ts (one call) so that file stays a list of thin handlers:
//   importScan / importNext / importCancel   importers (./index.ts)
//   shellReveal                              "Open in Finder" for an opened .md
//   traySetRecent                            the menubar's Recent Notes
"use strict";

import { BrowserWindow, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { IPC, MARKDOWN_EXTENSIONS, type ImportScanRequest, type TrayRecentNote } from "../../shared/ipc";
import { setTrayRecent } from "../tray";
import { cancelImport, hookImportCleanup, nextImportBatch, scanImport } from "./index";

export function registerMarkItDownIpc(): void {
  hookImportCleanup();

  ipcMain.handle(IPC.importScan, (e, req: ImportScanRequest) =>
    scanImport(BrowserWindow.fromWebContents(e.sender), { id: String(req?.id ?? ""), source: req?.source }),
  );
  ipcMain.handle(IPC.importNext, (_e, id: string, max: number) => nextImportBatch(id, max));
  ipcMain.handle(IPC.importCancel, (_e, id: string) => cancelImport(id));

  // Only files the app itself opens (markdown), and only if they exist: the
  // renderer cannot use this to probe the filesystem.
  ipcMain.handle(IPC.shellReveal, async (_e, filePath: string): Promise<void> => {
    const p = String(filePath ?? "");
    const ext = path.extname(p).slice(1).toLowerCase();
    if (!path.isAbsolute(p) || !(MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return;
    try {
      if (!(await fs.stat(p)).isFile()) return;
    } catch {
      return;
    }
    shell.showItemInFolder(p);
  });

  ipcMain.handle(IPC.traySetRecent, (_e, notes: TrayRecentNote[]): void => setTrayRecent(notes));
}
