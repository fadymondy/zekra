// macOS native UI language/direction (menubar, tray menu, context menus).
//
// AppKit decides a native menu's language and writing direction once, when the
// app launches, from the app's preferred localization — Electron can't flip an
// NSMenu to RTL at runtime. So the app's own `AppleLanguages` default (its
// defaults domain only, never the system's) mirrors the Zekra UI language, and
// the app relaunches when that default had to change. The bundle ships
// ar.lproj + en.lproj, so AppKit honours both.
"use strict";

import { app, systemPreferences } from "electron";

import type { LocaleId } from "../shared/ipc";

/** Passed on the one automatic relaunch, so a default that doesn't stick can
 *  never loop relaunches. */
const RELAUNCH_FLAG = "--zekra-language-applied";

/** Whether AppKit laid this process out right-to-left: fixed at launch, so
 *  captured before the default is rewritten. The traffic lights follow it
 *  (top-right in Arabic). */
let launchedRtl: boolean | null = null;

export function nativeRtl(): boolean {
  if (process.platform !== "darwin") return false;
  if (launchedRtl === null) launchedRtl = currentAppLanguage().toLowerCase().startsWith("ar");
  return launchedRtl;
}

function currentAppLanguage(): string {
  const langs = systemPreferences.getUserDefault("AppleLanguages", "array") as unknown;
  return Array.isArray(langs) && typeof langs[0] === "string" ? langs[0] : "";
}

function matches(locale: LocaleId): boolean {
  return currentAppLanguage().toLowerCase().split(/[-_]/)[0] === locale;
}

/** Point this app's AppKit language at `locale`. True if it changed (the
 *  running process keeps the old direction until relaunched). */
function writeAppLanguage(locale: LocaleId): boolean {
  if (process.platform !== "darwin" || matches(locale)) return false;
  systemPreferences.setUserDefault("AppleLanguages", "array", [locale]);
  return true;
}

/**
 * At launch, before any window exists: if the native UI language doesn't match
 * the Zekra language, fix it and relaunch at once (invisible — nothing is on
 * screen yet). Returns true when the app is relaunching; the caller must stop.
 */
export function ensureNativeLanguageAtLaunch(locale: LocaleId): boolean {
  if (process.platform !== "darwin") return false;
  nativeRtl(); // capture the direction this process launched with
  if (!writeAppLanguage(locale)) return false;
  if (process.argv.includes(RELAUNCH_FLAG)) return false; // already tried once
  app.relaunch({ args: [...process.argv.slice(1), RELAUNCH_FLAG] });
  app.exit(0);
  return true;
}

/** The Zekra language changed: update the native language and relaunch, so
 *  the menubar, tray and context menus take its direction (AppKit fixes it
 *  per process). Quitting flushes unsaved notes first and note windows are
 *  restored, so the switch is a brief blink. */
export function nativeLanguageChanged(locale: LocaleId): void {
  nativeRtl();
  if (!writeAppLanguage(locale)) return;
  // Let the settings write and the renderer's own re-render land first.
  setTimeout(() => {
    app.relaunch();
    app.quit(); // before-quit flushes unsaved notes
  }, 400);
}
