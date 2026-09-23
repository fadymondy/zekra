// Auto-update (electron-updater, GitHub provider fadymondy/zekra — the
// `publish` block in electron-builder.yml writes app-update.yml into the
// packaged app, which is where electron-updater reads the feed from).
//
// Lifecycle (every change is broadcast to all windows as UpdateState):
//
//   idle → checking → available (version, notes, size) → downloading
//   (percent, bytes/s, transferred/total) → downloaded → installing
//
//   - Checks shortly after launch and every 6 hours; Help ▸ Check for
//     Updates… / the tray open the renderer's Software Update sheet (or, with
//     no window, answer with native dialogs).
//   - autoDownload: the update downloads in the background as soon as it is
//     found. The renderer shows the loader in the sidebar footer
//     (features/updates) and the release notes in the sheet.
//   - Once downloaded, the pure policy in update-policy.ts decides — on
//     download and every minute after — whether to install now (auto-install
//     on, no unsaved edits, the user away: system idle ≥ 10 min, or ≥ 1 min
//     with no window on screen), prompt, or wait (snoozed with Later).
//     Installing flushes every editor first (window.__zekraFlushAll, the same
//     hook as quitting) and relaunches; when no window was on screen the
//     relaunch starts hidden (consumeHiddenRelaunch, main.ts).
//   - Install on quit (autoInstallOnAppQuit) follows Settings ▸ About ▸
//     "Install updates automatically"; critical releases always install on
//     quit and prompt with a native sheet.
//   - Critical releases: put `[critical]` anywhere in the GitHub release notes
//     (or its title). See update-policy.ts and README.md "Releasing updates".
//   - Channels: stable = full releases only; beta = pre-releases too
//     (allowPrerelease). Never downgrades.
//   - No-ops gracefully where updating cannot work: development builds, and
//     packaged builds without app-update.yml (`electron-builder --dir`,
//     `npm run pack`) report "disabled". "No releases yet" (404 / no
//     latest-mac.yml) is reported as such, never as a failure.
//   - macOS auto-update needs a SIGNED build and the zip target (both in
//     electron-builder.yml). ZEKRA_FORCE_UPDATES=1 (+ dev-app-update.yml)
//     exercises the flow from `npm run dev`.
"use strict";

import { app, BrowserWindow, dialog, Notification, powerMonitor } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import * as fs from "node:fs";
import * as path from "node:path";

import { IPC, type AppSettings, type UpdateState } from "../shared/ipc";
import { fmt, getMenuLocale, s } from "./menu-strings";
import { broadcast, focusMainWindow, getMainWindow, sendCommandWhenReady } from "./renderer-events";
import { getSettings } from "./settings-store";
import { hasUnsavedEdits } from "./unsaved-work";
import {
  decideInstall,
  installOnQuit,
  isCriticalRelease,
  normaliseReleaseNotes,
  snoozeFor,
  stripCriticalMarker,
} from "./update-policy";

const RECHECK_MS = 6 * 60 * 60 * 1000;
const DECIDE_EVERY_MS = 60 * 1000;
const FLUSH_TIMEOUT_MS = 3000;
const HIDDEN_MARKER = "update-relaunch-hidden";

// Updater-only strings (menu-strings.ts carries the shared ones).
const T = {
  en: {
    criticalDetail: "This is an important update. Zekra installs it the next time you quit, or restart now.",
    installing: "Installing the update…",
  },
  ar: {
    criticalDetail: "هذا تحديث مهم. ستثبّته ذكرة عند إنهائها في المرة القادمة، أو أعد التشغيل الآن.",
    installing: "جارٍ تثبيت التحديث…",
  },
} as const;
const tt = () => T[getMenuLocale() === "ar" ? "ar" : "en"];

let state: UpdateState = { status: "idle" };
let wired = false;
let checkTimer: NodeJS.Timeout | null = null;
let decideTimer: NodeJS.Timeout | null = null;
let snoozedUntil = 0;
let deciding = false;
/** Versions already announced this session (native sheet / notification). */
const modalShown = new Set<string>();
const notified = new Set<string>();
const listeners = new Set<(s: UpdateState) => void>();

/* ------------------------------------------------------------ gating */

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

function prefs(): { autoInstall: boolean; channel: AppSettings["updateChannel"] } {
  const cur = getSettings();
  return { autoInstall: cur.autoInstallUpdates !== false, channel: cur.updateChannel === "beta" ? "beta" : "stable" };
}

/** The state as the renderer sees it: always with version/channel/setting. */
function decorate(st: UpdateState): UpdateState {
  const p = prefs();
  return { ...st, currentVersion: app.getVersion(), channel: p.channel, autoInstall: p.autoInstall };
}

function setState(next: UpdateState): void {
  state = next;
  const out = decorate(state);
  broadcast(IPC.evUpdateState, out);
  for (const fn of listeners) fn(out);
}

export function getUpdateState(): UpdateState {
  return enabled() ? decorate(state) : decorate({ status: "disabled", message: disabledReason() });
}

/** For the tray, which relabels "Check for Updates…" as the state moves. */
export function subscribeUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isNoReleaseError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /404|latest-mac\.yml|latest\.yml|latest-linux\.yml|No published versions|Cannot find channel|HttpError: 404|app-update\.yml|ENOENT|net::ERR_/i.test(msg);
}

/* ------------------------------------------------------------ wiring */

/** What a release offers, from electron-updater's UpdateInfo. */
function releaseFields(info: UpdateInfo): Partial<UpdateState> {
  const raw = normaliseReleaseNotes(info.releaseNotes);
  const critical = isCriticalRelease({ releaseNotes: raw, releaseName: info.releaseName });
  const total = (info.files ?? []).find((f) => /\.(zip|exe|AppImage|deb)$/i.test(f.url))?.size ?? info.files?.[0]?.size;
  return {
    version: info.version,
    releaseNotes: stripCriticalMarker(raw) || undefined,
    releaseName: info.releaseName ? stripCriticalMarker(info.releaseName) : undefined,
    releaseDate: info.releaseDate,
    critical,
    total: total && total > 0 ? total : undefined,
  };
}

function applyPrefs(): void {
  const p = prefs();
  autoUpdater.allowPrerelease = p.channel === "beta";
  autoUpdater.autoInstallOnAppQuit = installOnQuit(p.autoInstall, Boolean(state.critical));
}

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = console as never;
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
  applyPrefs();

  autoUpdater.on("checking-for-update", () => {
    // Keep a download in progress / finished visible while re-checking.
    if (state.status !== "downloaded" && state.status !== "downloading") setState({ status: "checking" });
  });
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    if (state.status !== "downloaded") setState({ status: "not-available", version: info.version, checkedAt: Date.now() });
  });
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    setState({ status: "available", ...releaseFields(info), checkedAt: Date.now() });
    applyPrefs();
  });
  autoUpdater.on("download-progress", (p: ProgressInfo) =>
    setState({
      ...state,
      status: "downloading",
      progress: Math.round(p.percent * 10) / 10,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total || state.total,
    }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    setState({ ...state, status: "downloaded", ...releaseFields(info), progress: 100, bytesPerSecond: undefined });
    applyPrefs();
    startDeciding();
  });
  autoUpdater.on("error", (err) => {
    if (state.status === "installing") {
      // quitAndInstall failed (e.g. a signature mismatch on macOS): stay
      // quittable and keep offering the download.
      installingUpdate = false;
      setState({ ...state, status: "downloaded", message: String(err?.message ?? err) });
      return;
    }
    if (state.status === "downloaded") return;
    setState({
      status: "error",
      message: isNoReleaseError(err) ? s().updateNoReleases : String(err?.message ?? err),
      checkedAt: Date.now(),
    });
  });
}

/* ----------------------------------------------------------- policy */

function visibleWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized());
}

function startDeciding(): void {
  void decide();
  if (decideTimer) return;
  decideTimer = setInterval(() => void decide(), DECIDE_EVERY_MS);
  decideTimer.unref?.();
  // Stepping away is exactly when installing is welcome.
  powerMonitor.on("lock-screen", () => void decide());
}

/** Ask the policy (update-policy.ts) and act on it. */
async function decide(): Promise<void> {
  if (state.status !== "downloaded" || deciding) return;
  deciding = true;
  try {
    const p = prefs();
    const d = decideInstall({
      autoInstall: p.autoInstall,
      critical: Boolean(state.critical),
      unsaved: hasUnsavedEdits(),
      anyWindowVisible: visibleWindows().length > 0,
      idleSeconds: powerMonitor.getSystemIdleTime(),
      snoozedUntil,
      now: Date.now(),
    });
    if (d.action === "install") {
      console.log("[zekra] installing the downloaded update:", d.reason);
      await installUpdate({ auto: true });
      return;
    }
    const prompt = d.action === "prompt";
    if (Boolean(state.prompt) !== prompt) setState({ ...state, prompt });
    if (!prompt) return;
    const version = state.version ?? "";
    if (d.modal && !modalShown.has(version)) {
      modalShown.add(version);
      void promptRestart(version, true);
    } else {
      notifyIfNoWindow(version);
    }
  } finally {
    deciding = false;
  }
}

/** "Later" from the in-app card, the sheet or the native prompt. */
export function snoozeUpdate(): UpdateState {
  snoozedUntil = Date.now() + snoozeFor(Boolean(state.critical));
  if (state.prompt) setState({ ...state, prompt: false });
  return getUpdateState();
}

/** Settings ▸ About changed the channel or the auto-install switch. */
export function updaterOnSettingsChanged(patch: Partial<AppSettings>): void {
  if (patch.autoInstallUpdates === undefined && patch.updateChannel === undefined) return;
  if (!enabled()) {
    broadcast(IPC.evUpdateState, getUpdateState());
    return;
  }
  wire();
  applyPrefs();
  setState(state); // re-broadcast with the new channel / setting
  if (patch.updateChannel !== undefined) void silentCheck();
  if (patch.autoInstallUpdates !== undefined) void decide();
}

/* -------------------------------------------------------- prompting */

// With a window on screen the renderer shows the ready card. From the
// menubar alone there is no renderer to show it, so the OS notifies.
let liveNotification: Notification | null = null;
function notifyIfNoWindow(version: string): void {
  if (notified.has(version) || visibleWindows().length) return;
  if (!Notification.isSupported()) return;
  notified.add(version);
  liveNotification = new Notification({ title: s().updateTitle, body: `${fmt(s().updateReady, { version })} ${s().updateReadyDetail}` });
  liveNotification.on("click", () => void promptRestart(version, Boolean(state.critical)));
  liveNotification.show();
}

/** The native prompt — a sheet on the main window on macOS. */
async function promptRestart(version: string, critical: boolean): Promise<void> {
  const win = getMainWindow();
  const opts: Electron.MessageBoxOptions = {
    type: critical ? "warning" : "info",
    title: s().updateTitle,
    message: fmt(s().updateReady, { version }),
    detail: critical ? tt().criticalDetail : s().updateReadyDetail,
    buttons: [s().updateRestart, s().updateLater],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (response === 0) void installUpdate();
  else snoozeUpdate();
}

/* ----------------------------------------------------------- checks */

async function silentCheck(): Promise<void> {
  if (state.status === "downloading" || state.status === "downloaded" || state.status === "installing") return;
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
  if (!checkTimer) {
    checkTimer = setInterval(() => void silentCheck(), RECHECK_MS);
    checkTimer.unref?.();
  }
}

/** Programmatic check (renderer IPC). No dialogs. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!enabled()) return getUpdateState();
  wire();
  if (state.status === "downloaded" || state.status === "downloading" || state.status === "installing") return getUpdateState();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({
      status: "error",
      message: isNoReleaseError(err) ? s().updateNoReleases : String((err as Error)?.message ?? err),
      checkedAt: Date.now(),
    });
  }
  return getUpdateState();
}

/**
 * Help ▸ Check for Updates… / the tray. With a window: bring it forward and
 * open the Software Update sheet there (it checks and shows progress and
 * notes). Without one: answer with native dialogs.
 */
export async function checkForUpdatesInteractive(): Promise<void> {
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    focusMainWindow();
    sendCommandWhenReady("update:show", "menu");
    return;
  }
  const show = (message: string, detail?: string) => {
    const opts: Electron.MessageBoxOptions = { type: "info", title: s().updateTitle, message, detail, buttons: [s().ok], noLink: true };
    return dialog.showMessageBox(opts);
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
      await promptRestart(result.version ?? "", Boolean(result.critical));
      break;
    case "installing":
      await show(tt().installing);
      break;
    case "not-available":
      await show(s().updateNone, fmt(s().updateNoneDetail, { version: app.getVersion() }));
      break;
    default:
      await show(result.message === s().updateNoReleases ? s().updateNoReleases : s().updateFailed, result.message);
  }
}

/* ----------------------------------------------------------- install */

/** True while quitting to install an update — the quit-time note flush in
 *  main.ts must not hold that quit back (installUpdate flushed already). */
export let installingUpdate = false;

/** Every window's editors save what they have (the quit-time hook). */
async function flushAllWindows(): Promise<void> {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const flushed = Promise.all(
    wins.map((w) =>
      w.webContents.executeJavaScript("window.__zekraFlushAll ? window.__zekraFlushAll() : null", true).catch(() => undefined),
    ),
  );
  await Promise.race([flushed, new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))]);
}

function hiddenMarkerPath(): string {
  return path.join(app.getPath("userData"), HIDDEN_MARKER);
}

/** main.ts: an unattended install relaunched us — start in the menubar only,
 *  as the app was before. One-shot. */
export function consumeHiddenRelaunch(): boolean {
  try {
    fs.unlinkSync(hiddenMarkerPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Quit and install the downloaded update, then relaunch. Saves first; an
 * unattended install (`auto`) is silent on Windows and relaunches hidden when
 * no window was on screen.
 */
export async function installUpdate(opts: { auto?: boolean } = {}): Promise<boolean> {
  if (state.status !== "downloaded") return false;
  setState({ ...state, status: "installing", prompt: false });
  await flushAllWindows();
  if (opts.auto && hasUnsavedEdits()) {
    // Something became dirty while flushing: not now.
    setState({ ...state, status: "downloaded" });
    return false;
  }
  if (opts.auto && visibleWindows().length === 0) {
    try {
      fs.writeFileSync(hiddenMarkerPath(), String(Date.now()));
    } catch {
      /* best effort */
    }
  }
  installingUpdate = true;
  // isSilent: no installer UI (Windows NSIS) for unattended installs;
  // isForceRunAfter: relaunch.
  setImmediate(() => autoUpdater.quitAndInstall(Boolean(opts.auto), true));
  return true;
}
