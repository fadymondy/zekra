// The update policy — pure (no Electron), so it is unit-tested
// (test/update-policy.test.cjs) and updater.ts only gathers the facts.
//
// Once an update has DOWNLOADED, decideInstall() answers one question every
// time it is asked (on download, every minute after, on blur / lock / idle):
//
//   install  quit and install now, without asking. Only when auto-install is
//            on, no window has unsaved edits, and the user is away: the system
//            has been idle for IDLE_INSTALL_SECONDS (10 min), or — with no
//            Zekra window on screen at all (menubar only) — for
//            HIDDEN_IDLE_INSTALL_SECONDS. A focused, recently-used window is
//            never pulled out from under the user.
//   prompt   ask: "Zekra X.Y.Z is ready — Restart to Update / Later". Modal
//            (a native sheet) only for a critical release; otherwise the
//            in-app card in the sidebar footer.
//   wait     say nothing now: the user chose Later and the snooze has not run
//            out. The update still installs on quit (autoInstallOnAppQuit).
//
// Critical releases: a release whose notes or title contain the marker
// `[critical]` (case-insensitive, anywhere). They are prompted modally even
// when auto-install is off, their Later only snoozes for CRITICAL_SNOOZE_MS,
// and they always install on quit (updater.ts forces autoInstallOnAppQuit).
"use strict";

export const IDLE_INSTALL_SECONDS = 10 * 60;
export const HIDDEN_IDLE_INSTALL_SECONDS = 60;
export const SNOOZE_MS = 4 * 60 * 60 * 1000;
export const CRITICAL_SNOOZE_MS = 60 * 60 * 1000;

export const CRITICAL_MARKER = /\[critical\]/i;

/** electron-updater's UpdateInfo.releaseNotes: a string (GitHub: the release
 *  body as HTML), or per-version notes when fullChangelog is on. */
export type ReleaseNotesInput = string | ReadonlyArray<{ version: string; note: string | null }> | null | undefined;

export function normaliseReleaseNotes(notes: ReleaseNotesInput): string {
  if (!notes) return "";
  if (typeof notes === "string") return notes.trim();
  return notes
    .filter((n) => n && n.note)
    .map((n) => `### ${n.version}\n\n${String(n.note).trim()}`)
    .join("\n\n")
    .trim();
}

export function isCriticalRelease(info: { releaseNotes?: ReleaseNotesInput; releaseName?: string | null }): boolean {
  return CRITICAL_MARKER.test(normaliseReleaseNotes(info.releaseNotes)) || CRITICAL_MARKER.test(info.releaseName ?? "");
}

/** The notes as shown to the user: without the `[critical]` marker. */
export function stripCriticalMarker(text: string): string {
  return text
    .replace(/\s*\[critical\]\s*/gi, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface InstallContext {
  /** Settings ▸ About ▸ Install updates automatically. */
  autoInstall: boolean;
  critical: boolean;
  /** Any window reports unsaved edits (the workspace's edited flag). */
  unsaved: boolean;
  /** A Zekra window is visible (not hidden / minimised). */
  anyWindowVisible: boolean;
  /** powerMonitor.getSystemIdleTime(), seconds. */
  idleSeconds: number;
  /** "Later" was chosen; the prompt stays quiet until then (ms epoch, 0 = never). */
  snoozedUntil: number;
  now: number;
}

export type InstallAction = "install" | "prompt" | "wait";

export interface InstallDecision {
  action: InstallAction;
  /** prompt only: a native modal sheet instead of the in-app card. */
  modal: boolean;
  reason: string;
}

export function userIsAway(ctx: Pick<InstallContext, "anyWindowVisible" | "idleSeconds">): boolean {
  if (ctx.idleSeconds >= IDLE_INSTALL_SECONDS) return true;
  return !ctx.anyWindowVisible && ctx.idleSeconds >= HIDDEN_IDLE_INSTALL_SECONDS;
}

export function decideInstall(ctx: InstallContext): InstallDecision {
  const snoozed = ctx.snoozedUntil > ctx.now;
  if (ctx.unsaved) {
    // Never quit over unsaved text — not even for a critical release.
    if (snoozed) return { action: "wait", modal: false, reason: "unsaved-snoozed" };
    return { action: "prompt", modal: false, reason: "unsaved" };
  }
  if (ctx.autoInstall && userIsAway(ctx)) return { action: "install", modal: false, reason: "idle" };
  if (snoozed) return { action: "wait", modal: false, reason: "snoozed" };
  if (ctx.critical) return { action: "prompt", modal: true, reason: "critical" };
  return { action: "prompt", modal: false, reason: "ready" };
}

/** How long "Later" keeps the prompt quiet. */
export function snoozeFor(critical: boolean): number {
  return critical ? CRITICAL_SNOOZE_MS : SNOOZE_MS;
}

/** Install on quit: when auto-install is on, and always for critical releases. */
export function installOnQuit(autoInstall: boolean, critical: boolean): boolean {
  return autoInstall || critical;
}
