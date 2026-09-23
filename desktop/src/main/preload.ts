// The only bridge between the sandboxed renderer and Electron: `window.zekra`,
// typed by ZekraBridge in src/shared/ipc.ts. contextIsolation + sandbox stay
// on; nothing else from Node is exposed.
//
// NOTE: a sandboxed preload cannot require() local files, so this file is
// BUNDLED by esbuild (build/bundle.mjs -> out/main/preload.js) with
// src/shared/ipc.ts inlined. tsc also type-checks it with the main project.
"use strict";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { IPC, type ZekraBridge } from "../shared/ipc";

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: ZekraBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  patchSettings: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch),
  clearSession: () => ipcRenderer.invoke(IPC.settingsClearSession),

  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getVersion: async () => (await ipcRenderer.invoke(IPC.appInfo)).version,
  openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
  rendererReady: () => ipcRenderer.invoke(IPC.appRendererReady),
  showAboutPanel: () => ipcRenderer.invoke(IPC.appShowAbout),

  apiRequest: (req) => ipcRenderer.invoke(IPC.apiRequest, req),
  apiBinary: (pathOrUrl) => ipcRenderer.invoke(IPC.apiBinary, pathOrUrl),

  saveFile: (req) => ipcRenderer.invoke(IPC.dialogSave, req),
  openFile: (req) => ipcRenderer.invoke(IPC.dialogOpen, req),
  confirm: (req) => ipcRenderer.invoke(IPC.dialogConfirm, req),
  printToPdf: (req) => ipcRenderer.invoke(IPC.printToPdf, req),
  notify: (req) => ipcRenderer.invoke(IPC.notify, req),
  canPromptTouchId: () => ipcRenderer.invoke(IPC.touchIdCan),
  promptTouchId: (reason) => ipcRenderer.invoke(IPC.touchIdPrompt, reason),
  writeClipboardText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
  writeSecretText: (text, clearAfterMs) => ipcRenderer.invoke(IPC.clipboardWriteSecret, text, clearAfterMs), // MH-450 vault
  setDocumentEdited: (edited) => ipcRenderer.invoke(IPC.windowSetEdited, edited),
  closeWindow: () => ipcRenderer.invoke(IPC.windowClose),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  getUpdateState: () => ipcRenderer.invoke(IPC.updateGetState),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  setTrayStatus: (status) => ipcRenderer.invoke(IPC.traySetStatus, status),
  // MH-450: Dock badge (notifications) + MCP install (settings ▸ connect)
  setBadgeCount: (count) => ipcRenderer.invoke(IPC.appSetBadge, count),
  installMcp: (target, url) => ipcRenderer.invoke(IPC.mcpInstall, target, url),
  getMcpStatus: () => ipcRenderer.invoke(IPC.mcpStatus),
  // MH-450 Mark It Down features: importers, reveal in Finder, tray recents
  importScan: (req) => ipcRenderer.invoke(IPC.importScan, req),
  importNext: (id, max) => ipcRenderer.invoke(IPC.importNext, id, max),
  importCancel: (id) => ipcRenderer.invoke(IPC.importCancel, id),
  revealInFinder: (p) => ipcRenderer.invoke(IPC.shellReveal, p),
  setTrayRecent: (notes) => ipcRenderer.invoke(IPC.traySetRecent, notes),

  onCommand: (cb) => on(IPC.evCommand, cb),
  onDeepLink: (cb) => on(IPC.evDeepLink, cb),
  onOpenFile: (cb) => on(IPC.evOpenFile, cb),
  onNotificationClick: (cb) => on(IPC.evNotificationClick, cb),
  onSystemThemeChanged: (cb) => on(IPC.evSystemTheme, cb),
  onWindowState: (cb) => on(IPC.evWindowState, cb),
  onUpdateState: (cb) => on(IPC.evUpdateState, cb),
  onAppActivity: (cb) => on(IPC.evAppActivity, cb), // MH-450 app lock
  onImportProgress: (cb) => on(IPC.evImportProgress, cb), // MH-450 importers
};

contextBridge.exposeInMainWorld("zekra", api);
