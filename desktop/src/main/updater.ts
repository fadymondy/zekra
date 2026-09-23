// Auto-update (electron-updater, GitHub provider fadymondy/zekra — the
// `publish` block in electron-builder.yml writes app-update.yml into the
// packaged app, which is where electron-updater reads the feed from).
//
// Posture (MH-450, after Mark It Down's desktop-auto-update):
//   - Channel "stable": only full GitHub releases, never pre-releases or
//     downgrades. electron-builder's default channel file is latest-mac.yml
//     ("latest"), which IS the stable channel; naming it "stable" would need
//     electron-builder to publish a stable-mac.yml as well.
//   - Downloads in the background as soon as an update is found; every state
//     change is broadcast to the renderer (evUpdateState). The renderer shows
//     "Restart to update" (features/open-file/update-toasts.tsx); when no
//     window is open, a native notification does the same job.
//   - No-ops gracefully where updating cannot work: development builds, and
//     packaged builds without app-update.yml (`electron-builder --dir`,
//     `npm run pack`). "No releases yet" (404 / no latest-mac.yml) is reported
//     as such, never as a failure, and never from the background check.
//   - A silent check shortly after launch and every 6 hours after;
//     Help ▸ Check for Updates… / the tray item run an interactive check that
//     always answers with a dialog.
//   - macOS auto-update needs a SIGNED build and the zip target (both in
//     electron-builder.yml). ZEKRA_FORCE_UPDATES=1 (+ dev-app-update.yml)
//     exercises the flow from `npm run dev`.
"use strict";

import { app, dialog, Notification } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import * as fs from "node:fs";
import * as path from "node:path";

import { IPC, type UpdateState } from "../shared/ipc";
import { fmt, s } from "./menu-strings";
import { broadcast, getMainWindow } from "./renderer-events";

const RECHECK_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { status: "idle" };
let wired = false;
let timer: NodeJS.Timeout | null = null;
const listeners = new Set<(s: UpdateState) => void>();

/** Where electron-updater looks for the feed config in a packaged app. */
function hasFeedConfig(): boolean {
  if (!app.isPackaged) return fs.existsSync(path.join(app.getAppPath(), "dev-app-update.yml"));
  return fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

function enabled(): boolean {
  if (process.env.ZEKRA_FORCE_UPDATES === "1") return true;
  return app.isPackaged && hasFeedConfig();
}

function disabledReason(): string {
  return app.isPackaged ? s().updateNoReleases : s().devBuild;
}

function setState(next: UpdateState): void {
  state = next;
  broadcast(IPC.evUpdateState, state);
  for (const fn of listeners) fn(state);
}

export function getUpdateState(): UpdateState {
  return enabled() ? state : { status: "disabled", message: disabledReason() };
}

/** For the tray, which relabels "Check for Updates…" as the state moves. */
export function subscribeUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isNoReleaseError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /404|latest-mac\.yml|latest\.yml|No published versions|Cannot find channel|HttpError: 404|app-update\.yml|ENOENT|net::ERR_/i.test(msg);
}

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = console as never;
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.on("checking-for-update", () => {
    // Keep a finished download visible while re-checking in the background.
    if (state.status !== "downloaded") setState({ status: "checking" });
  });
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    if (state.status !== "downloaded") setState({ status: "not-available", version: info.version });
  });
  autoUpdater.on("update-available", (info: UpdateInfo) => setState({ status: "available", version: info.version }));
  autoUpdater.on("download-progress", (p) =>
    setState({ status: "downloading", version: state.version, progress: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    setState({ status: "downloaded", version: info.version });
    notifyIfNoWindow(info.version);
  });
  autoUpdater.on("error", (err) => {
    if (state.status === "downloaded") return;
    setState({ status: "error", message: isNoReleaseError(err) ? s().updateNoReleases : String(err?.message ?? err) });
  });
}

// With a window open the renderer shows the "Restart to update" toast. From
// the menubar alone there is no renderer to show it, so macOS notifies.
let liveNotification: Notification | null = null;
function notifyIfNoWindow(version: string): void {
  const win = getMainWindow();
  if (win && win.isVisible()) return;
  if (!Notification.isSupported()) return;
  liveNotification = new Notification({ title: s().updateTitle, body: `${fmt(s().updateReady, { version })} ${s().updateReadyDetail}` });
  liveNotification.on("click", () => void promptRestart(version));
  liveNotification.show();
}

async function promptRestart(version: string): Promise<void> {
  const win = getMainWindow();
  const opts: Electron.MessageBoxOptions = {
    type: "info",
    title: s().updateTitle,
    message: fmt(s().updateReady, { version }),
    detail: s().updateReadyDetail,
    buttons: [s().updateRestart, s().updateLater],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (response === 0) installUpdate();
}

async function silentCheck(): Promise<void> {
  if (state.status === "downloading" || state.status === "downloaded") return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.warn("[zekra] update check failed:", (err as Error)?.message ?? err);
  }
}

/** Background checks: once shortly after launch, then every 6 hours. */
export function startUpdater(): void {
  if (!enabled()) {
    console.log("[zekra] auto-update disabled:", disabledReason());
    return;
  }
  wire();
  setTimeout(() => void silentCheck(), 8000);
  if (!timer) {
    timer = setInterval(() => void silentCheck(), RECHECK_MS);
    timer.unref?.();
  }
}

/** Programmatic check (renderer IPC). No dialogs. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!enabled()) return getUpdateState();
  wire();
  if (state.status === "downloaded" || state.status === "downloading") return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({ status: "error", message: isNoReleaseError(err) ? s().updateNoReleases : String((err as Error)?.message ?? err) });
  }
  return state;
}

/** Help ▸ Check for Updates… / the tray — always answers with a dialog. */
export async function checkForUpdatesInteractive(): Promise<void> {
  const win = getMainWindow();
  const show = (message: string, detail?: string) => {
    const opts: Electron.MessageBoxOptions = { type: "info", title: s().updateTitle, message, detail, buttons: [s().ok], noLink: true };
    return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
  };
  if (!enabled()) {
    await show(disabledReason());
    return;
  }
  const result = await checkForUpdates();
  switch (result.status) {
    case "available":
    case "downloading":
      await show(fmt(s().updateAvailable, { version: result.version ?? "" }), s().updateAvailableDetail);
      break;
    case "downloaded":
      await promptRestart(result.version ?? "");
      break;
    case "not-available":
      await show(s().updateNone, fmt(s().updateNoneDetail, { version: app.getVersion() }));
      break;
    default:
      await show(result.message === s().updateNoReleases ? s().updateNoReleases : s().updateFailed, result.message);
  }
}

/** True while quitting to install an update — the quit-time note flush in
 *  main.ts must not hold that quit back. */
export let installingUpdate = false;

export function installUpdate(): boolean {
  if (state.status !== "downloaded") return false;
  installingUpdate = true;
  // isSilent=false (show the installer UI where there is one), and relaunch.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}
