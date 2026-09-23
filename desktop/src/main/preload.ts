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
  snoozeUpdate: () => ipcRenderer.invoke(IPC.updateSnooze),
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
  // Native shell (src/main/native-ui.ts)
  showContextMenu: (req) => ipcRenderer.invoke(IPC.menuPopup, req),
  popupAppMenu: (x, y) => ipcRenderer.invoke(IPC.menuPopupApp, x, y),
  openNoteWindow: (req) => ipcRenderer.invoke(IPC.windowOpenNote, req),
  setWindowChrome: (colors) => ipcRenderer.invoke(IPC.windowSetChrome, colors),
  // App windows (src/main/app-windows.ts): Settings, Spotlight, New Brain, New Note
  openSettingsWindow: (section) => ipcRenderer.invoke(IPC.windowOpenSettings, section),
  openSpotlight: () => ipcRenderer.invoke(IPC.windowOpenSpotlight),
  openNewBrainWindow: () => ipcRenderer.invoke(IPC.windowOpenNewBrain),
  openNewNoteWindow: (ns) => ipcRenderer.invoke(IPC.windowOpenNewNote, ns ?? null),
  noteWindowCreated: (req) => ipcRenderer.invoke(IPC.windowNoteCreated, req),
  openInMain: (route) => ipcRenderer.invoke(IPC.windowOpenInMain, route),
  hideSelf: () => ipcRenderer.invoke(IPC.windowHideSelf),
  resizeSelf: (height) => ipcRenderer.invoke(IPC.windowResizeSelf, height),
  setSpotlightShortcut: (accel) => ipcRenderer.invoke(IPC.windowSetSpotlightShortcut, accel),
  broadcast: (msg) => ipcRenderer.invoke(IPC.appBroadcast, msg),
  setTrayState: (state) => ipcRenderer.invoke(IPC.traySetState, state),
  onSettingsChanged: (cb) => on(IPC.evSettingsChanged, cb),
  onBroadcast: (cb) => on(IPC.evBroadcast, cb),
  onWindowShown: (cb) => on(IPC.evWindowShown, cb),
  onSettingsSection: (cb) => on(IPC.evSettingsSection, cb),

  // Desktop services (src/main/services.ts): offline cache + sync, Quick
  // Capture, share, rich notifications, login item / shortcut info.
  offlineNotes: (ns, query) => ipcRenderer.invoke(IPC.offlineNotes, ns, query),
  offlineNote: (ns, id) => ipcRenderer.invoke(IPC.offlineNote, ns, id),
  offlineBrains: () => ipcRenderer.invoke(IPC.offlineBrains),
  offlineVersions: (ns, id) => ipcRenderer.invoke(IPC.offlineVersions, ns, id),
  offlinePut: (note) => ipcRenderer.invoke(IPC.offlinePut, note),
  offlineEnqueue: (edit) => ipcRenderer.invoke(IPC.offlineEnqueue, edit),
  offlineResolveBase: (id, version) => ipcRenderer.invoke(IPC.offlineResolveBase, id, version),
  offlineSyncNow: () => ipcRenderer.invoke(IPC.offlineSyncNow),
  offlineStatus: () => ipcRenderer.invoke(IPC.offlineStatus),
  offlineClear: (includeQueue) => ipcRenderer.invoke(IPC.offlineClear, includeQueue),
  offlineDismissConflict: (id) => ipcRenderer.invoke(IPC.offlineDismissConflict, id),
  openQuickCapture: () => ipcRenderer.invoke(IPC.captureOpen),
  captureInit: () => ipcRenderer.invoke(IPC.captureInit),
  captureSave: (req) => ipcRenderer.invoke(IPC.captureSave, req),
  captureClose: () => ipcRenderer.invoke(IPC.captureClose),
  captureClipboard: () => ipcRenderer.invoke(IPC.captureClipboard),
  captureBrowserTab: () => ipcRenderer.invoke(IPC.captureBrowserTab),
  getServicesInfo: () => ipcRenderer.invoke(IPC.servicesInfo),
  setQuickCaptureShortcut: (accel) => ipcRenderer.invoke(IPC.servicesSetShortcut, accel),
  shareNote: (req) => ipcRenderer.invoke(IPC.shareNote, req),
  notifyRich: (req) => ipcRenderer.invoke(IPC.notifyRich, req),
  onSyncStatus: (cb) => on(IPC.evSyncStatus, cb),
  onSyncChange: (cb) => on(IPC.evSyncChange, cb),
  onNotificationAction: (cb) => on(IPC.evNotificationAction, cb),
  onCaptureShow: (cb) => on(IPC.evCaptureShow, cb),

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
