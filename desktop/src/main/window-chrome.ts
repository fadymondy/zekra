// Per-platform window chrome — the ONE place that decides how a Zekra window
// is framed on each OS, so every window factory (the main window, note
// windows, service windows) looks native wherever it runs:
//
//   macOS    hiddenInset title bar: the traffic lights sit over the renderer's
//            52px unified toolbar; the window is transparent over a "sidebar"
//            vibrancy material that follows the key state (Finder, Notes).
//   Windows  hidden title bar + titleBarOverlay: native caption buttons
//            (min / max / close) over the renderer's 40px title bar, in the
//            theme's colours; Mica behind the window on Windows 11.
//   Linux    the window manager's own frame (never fight the WM); the menu
//            bar auto-hides and Alt reveals it, like GTK apps.
//
// The renderer adapts to the same facts through getAppInfo()
// (windowControlsFor / chrome / titleBarHeight / material) — <html
// data-platform> + CSS tokens in src/renderer/theme.css.
"use strict";

import { nativeTheme, type BrowserWindowConstructorOptions } from "electron";
import * as os from "node:os";

import type { AppInfo } from "../shared/ipc";
import { nativeRtl } from "./app-language";

export type Platform = "darwin" | "win32" | "linux";

export const TITLEBAR_HEIGHT: Record<Platform, number> = { darwin: 52, win32: 40, linux: 46 };
/** Width of the three Windows caption buttons (46px each). */
const WIN_CAPTION_WIDTH = 138;
const MAC_TRAFFIC_LIGHT_INSET = 80;

export function currentPlatform(): Platform {
  return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
}

/** Windows 11 is Windows NT 10.0 build 22000+. */
export function isWindows11(): boolean {
  if (process.platform !== "win32") return false;
  const build = Number(os.release().split(".")[2] ?? 0);
  return build >= 22000;
}

/** The Zekra ground for the resolved theme (painted before the first frame). */
function solidGround(): string {
  return nativeTheme.shouldUseDarkColors ? "#0B1429" : "#F0EBE1";
}

/** What the window paints before (and behind) the renderer. Transparent where
 *  a system material shows through. */
export function windowBackgroundFor(platform: Platform = currentPlatform()): string {
  if (platform === "darwin") return "#00000000";
  if (platform === "win32" && isWindows11()) return "#00000000";
  return solidGround();
}

export function windowControlsFor(platform: Platform = currentPlatform()): AppInfo["windowControls"] {
  // AppKit mirrors the traffic lights to the top-right in an RTL (Arabic) launch.
  if (platform === "darwin") return { side: nativeRtl() ? "right" : "left", inset: MAC_TRAFFIC_LIGHT_INSET };
  if (platform === "win32") return { side: "right", inset: WIN_CAPTION_WIDTH };
  return { side: "right", inset: 0 };
}

export function chromeInfo(platform: Platform = currentPlatform()): Pick<AppInfo, "windowControls" | "osVersion" | "chrome" | "titleBarHeight" | "material"> {
  return {
    windowControls: windowControlsFor(platform),
    osVersion: os.release(),
    chrome: platform === "darwin" ? "hidden-inset" : platform === "win32" ? "overlay" : "frame",
    titleBarHeight: TITLEBAR_HEIGHT[platform],
    material: platform === "darwin" ? "vibrancy" : platform === "win32" && isWindows11() ? "mica" : "none",
  };
}

/** BrowserWindow options that frame a window natively on this OS. */
export function windowChromeFor(platform: Platform = currentPlatform()): BrowserWindowConstructorOptions {
  const backgroundColor = windowBackgroundFor(platform);
  if (platform === "darwin") {
    return {
      backgroundColor,
      titleBarStyle: "hiddenInset",
      // Centred in the 52px toolbar row.
      trafficLightPosition: { x: 18, y: 19 },
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
    };
  }
  if (platform === "win32") {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      backgroundColor,
      titleBarStyle: "hidden",
      // Re-coloured from the theme tokens by the renderer (setWindowChrome).
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: dark ? "#F0EBE1" : "#0E1A3C",
        height: TITLEBAR_HEIGHT.win32,
      },
      ...(isWindows11() ? { backgroundMaterial: "mica" as const } : {}),
      // Accelerators keep working from the hidden application menu; the menu
      // itself opens from the title bar's "…" button (popupAppMenu).
      autoHideMenuBar: true,
    };
  }
  return {
    backgroundColor,
    autoHideMenuBar: true,
  };
}
