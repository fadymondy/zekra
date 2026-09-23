import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { getLocales } from "expo-localization";
import { Dimensions, PixelRatio, Platform } from "react-native";

import { onApiResult } from "@/lib/api";

import {
  consoleSnapshot,
  createRing,
  failedCount,
  formatArg,
  networkSnapshot,
  redact,
  safePath,
  type ConsoleEntry,
  type DeviceInfo,
  type NetworkEntry,
} from "./mahaam-core";

// What a "Report a problem" carries besides the reporter's words: the last
// console errors/warnings, uncaught errors and unhandled rejections, recent API
// calls (method, path, status, time — never a body, header or query string) and
// the trail of screens/actions from crash.ts breadcrumb(). Everything is
// redacted BEFORE it is buffered and lives only in memory, in bounded rings;
// nothing leaves the phone unless the reporter presses Send with diagnostics on.

const consoleRing = createRing<ConsoleEntry>(100);
const networkRing = createRing<NetworkEntry>(50);
const crumbRing = createRing<string>(30);

const now = () => new Date().toISOString();

function record(level: ConsoleEntry["level"], args: unknown[]) {
  try {
    consoleRing.push({ level, message: redact(args.map((a) => formatArg(a)).join(" ")), at: now() });
  } catch {}
}

/** A trail line (screen change, action). Called by crash.ts breadcrumb(). */
export function addCrumb(message: string): void {
  crumbRing.push(`${now().slice(11, 19)} ${redact(message).slice(0, 200)}`);
}

/** A handled error the app reported (crash.ts reportError). */
export function noteError(error: unknown, context?: string): void {
  record("error", context ? [`[${context}]`, error] : [error]);
}

type UncaughtListener = (error: unknown, isFatal: boolean) => void;
const uncaughtListeners = new Set<UncaughtListener>();

/** Uncaught JS errors (ErrorUtils) and unhandled rejections (release builds). */
export function onUncaught(listener: UncaughtListener): () => void {
  uncaughtListeners.add(listener);
  return () => void uncaughtListeners.delete(listener);
}

function emitUncaught(error: unknown, isFatal: boolean) {
  uncaughtListeners.forEach((l) => {
    try {
      l(error, isFatal);
    } catch {}
  });
}

type ErrorUtilsLike = {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
};
type HermesLike = {
  enablePromiseRejectionTracker?: (opts: { allRejections: boolean; onUnhandled: (id: number, rejection: unknown) => void; onHandled: (id: number) => void }) => void;
};

let installed = false;

/**
 * Start recording. Idempotent; called from initCrashReporting() at app start.
 * Every hook forwards to what was there before (LogBox, Crashlytics' own
 * handler) and never changes what the app sees, including on failure.
 */
export function installDiagnostics(): void {
  if (installed || Platform.OS === "web") return;
  installed = true;

  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    let busy = false;
    console[level] = (...args: unknown[]) => {
      if (!busy) {
        busy = true;
        record(level, args);
        busy = false;
      }
      original(...args);
    };
  }

  const g = globalThis as unknown as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike };
  const eu = g.ErrorUtils;
  if (eu) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      record("error", [`Uncaught${isFatal ? " (fatal)" : ""}`, error]);
      emitUncaught(error, !!isFatal);
      previous?.(error, isFatal);
    });
  }

  // Dev builds already track rejections (RN routes them to console.error, which
  // is recorded above); release builds track none, so install one there.
  if (!__DEV__) {
    try {
      g.HermesInternal?.enablePromiseRejectionTracker?.({
        allRejections: true,
        onUnhandled: (_id, rejection) => {
          record("error", ["Unhandled rejection:", rejection]);
          emitUncaught(rejection, false);
        },
        onHandled: () => {},
      });
    } catch {}
  }

  onApiResult((r) => {
    networkRing.push({
      method: r.method,
      url: safePath(r.path),
      status: r.status,
      ms: r.ms,
      at: now(),
      error: r.error ? redact(r.error).slice(0, 200) : undefined,
    });
  });
}

export const diagnostics = {
  consoleLog: () => consoleSnapshot(consoleRing.items()),
  networkLog: () => networkSnapshot(networkRing.items()),
  crumbs: () => crumbRing.items(),
  counts: () => {
    const c = consoleRing.items();
    const n = networkRing.items();
    return { errors: c.filter((e) => e.level === "error").length, requests: n.length, failed: failedCount(n) };
  },
};

// ─── Reporter context (kept current by MahaamReportHost) ─────────────────────

let currentRoute = "/";
let reporterEmail = "";

/** Route PATTERN ("/note/[id]"), from the router's segments. */
export function setCurrentRoute(route: string): void {
  currentRoute = safePath(route || "/");
}
export const getCurrentRoute = () => currentRoute;

export function setReporterEmail(email: string | null | undefined): void {
  reporterEmail = (email ?? "").trim();
}
export const getReporterEmail = () => reporterEmail;

// ─── Sensitive screens ───────────────────────────────────────────────────────

const sensitive = new Set<string>();

/** A component showing a secret (a revealed vault value) marks itself; no screenshot is taken meanwhile. */
export function markSensitive(id: string, on: boolean): void {
  if (on) sensitive.add(id);
  else sensitive.delete(id);
}
export const sensitiveOnScreen = () => sensitive.size > 0;

// ─── Device ───────────────────────────────────────────────────────────────────

export function deviceInfo(): DeviceInfo {
  const cfg = Constants.expoConfig;
  let locale = "unknown";
  try {
    locale = getLocales()[0]?.languageTag ?? "unknown";
  } catch {}
  const { width, height } = Dimensions.get("window");
  const model = Platform.OS === "ios"
    ? Device.modelId ?? Device.modelName ?? "iPhone"
    : [Device.manufacturer, Device.modelName].filter(Boolean).join(" ") || "Android";
  return {
    appVersion: Application.nativeApplicationVersion ?? cfg?.version ?? "dev",
    build: Application.nativeBuildVersion ?? String((Platform.OS === "android" ? cfg?.android?.versionCode : cfg?.ios?.buildNumber) ?? "local"),
    platform: Platform.OS,
    osVersion: Device.osVersion ?? String(Platform.Version),
    model,
    locale,
    viewport: `${Math.round(width)}x${Math.round(height)}@${PixelRatio.get()}`,
  };
}
