// Quick Capture ▸ "From browser": the URL + title of the active tab of the
// browser the user was in when they pressed the shortcut. macOS only.
//
//  1. Before the capture panel shows, `lsappinfo` (Launch Services; no Apple
//     Events, no permission prompt) names the frontmost app. It must run
//     first: once the panel is up, Zekra is frontmost.
//  2. If that app is a scriptable browser, AppleScript asks it for the active
//     tab. That DOES need Automation permission (TCC, Apple Events). The
//     hardened runtime needs `com.apple.security.automation.apple-events`
//     (build/entitlements.mac.plist) and NSAppleEventsUsageDescription
//     (electron-builder.yml) or macOS refuses without even prompting.
//     A denial (-1743) comes back as status "denied" with a hint.
//
// Firefox has no AppleScript dictionary; it (and every browser on Windows /
// Linux, where there is no equivalent API) reports "unsupported" and the
// panel offers the clipboard instead.
"use strict";

import { execFile } from "node:child_process";

import type { BrowserTabResult } from "../shared/ipc";

type Flavour = "safari" | "chromium";

/** Scriptable browsers by bundle id. */
const BROWSERS: Record<string, { name: string; flavour: Flavour }> = {
  "com.apple.Safari": { name: "Safari", flavour: "safari" },
  "com.apple.SafariTechnologyPreview": { name: "Safari Technology Preview", flavour: "safari" },
  "com.google.Chrome": { name: "Google Chrome", flavour: "chromium" },
  "com.google.Chrome.beta": { name: "Google Chrome Beta", flavour: "chromium" },
  "com.google.Chrome.canary": { name: "Google Chrome Canary", flavour: "chromium" },
  "org.chromium.Chromium": { name: "Chromium", flavour: "chromium" },
  "com.brave.Browser": { name: "Brave", flavour: "chromium" },
  "com.microsoft.edgemac": { name: "Microsoft Edge", flavour: "chromium" },
  "com.vivaldi.Vivaldi": { name: "Vivaldi", flavour: "chromium" },
  "com.operasoftware.Opera": { name: "Opera", flavour: "chromium" },
  "company.thebrowser.Browser": { name: "Arc", flavour: "chromium" },
};

export const AUTOMATION_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? Number((err as { code?: unknown }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (err ? err.message : "") });
    });
  });
}

/** Parse `lsappinfo info -only bundleid <asn>` output. */
export function parseLsappinfoBundleId(out: string): string | null {
  const m = /bundleID="([^"]+)"/i.exec(out) ?? /"CFBundleIdentifier"="([^"]+)"/.exec(out);
  return m ? m[1] : null;
}

/** The frontmost app's bundle id (macOS), or null. Fast (~20 ms), no prompts. */
export async function frontmostBundleId(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const front = await run("/usr/bin/lsappinfo", ["front"], 500);
  const asn = front.stdout.trim();
  if (front.code !== 0 || !asn) return null;
  const info = await run("/usr/bin/lsappinfo", ["info", "-only", "bundleid", asn], 500);
  return info.code === 0 ? parseLsappinfoBundleId(info.stdout) : null;
}

export function isScriptableBrowser(bundleId: string | null): boolean {
  return Boolean(bundleId && BROWSERS[bundleId]);
}

/** The AppleScript that returns "URL\ntitle" of the active tab. */
export function tabScript(bundleId: string): string | null {
  const b = BROWSERS[bundleId];
  if (!b) return null;
  const tab = b.flavour === "safari" ? "current tab of front window" : "active tab of front window";
  const title = b.flavour === "safari" ? "name" : "title";
  return [
    `tell application id "${bundleId}"`,
    `  if (count of windows) is 0 then return ""`,
    `  set t to ${tab}`,
    `  return (URL of t) & linefeed & (${title} of t)`,
    `end tell`,
  ].join("\n");
}

/** Ask `bundleId` (the app that was frontmost) for its active tab. */
export async function activeBrowserTab(bundleId: string | null): Promise<BrowserTabResult> {
  if (process.platform !== "darwin") return { status: "unsupported" };
  if (!bundleId) return { status: "no-browser" };
  const script = tabScript(bundleId);
  if (!script) return { status: "no-browser", message: bundleId };
  const browser = BROWSERS[bundleId].name;
  // Never launches the browser: `tell application id` of a running app only.
  const res = await run("/usr/bin/osascript", ["-e", script], 8_000);
  if (res.code !== 0) {
    if (/not authori[sz]ed|not allowed|errAEEventNotPermitted|-1743|-10004/i.test(res.stderr)) {
      return { status: "denied", browser, message: res.stderr.trim() };
    }
    return { status: "error", browser, message: res.stderr.trim() || `osascript exited ${res.code}` };
  }
  const [url = "", ...rest] = res.stdout.replace(/\r/g, "").trimEnd().split("\n");
  if (!/^https?:\/\//i.test(url.trim())) return { status: "no-browser", browser, message: "no web page" };
  return { status: "ok", browser, url: url.trim(), title: rest.join(" ").trim() };
}
