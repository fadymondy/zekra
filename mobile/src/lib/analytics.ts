import { useSegments } from "expo-router";
import { useEffect } from "react";

import { breadcrumb, firebaseReady } from "@/lib/crash";
import { rnfbAnalytics } from "@/lib/firebase";

// Product analytics (MH-373): which screens are used and a handful of named
// actions — enough to see whether features are used, nothing about WHAT is in
// them. Defaults suited to a productivity app, needing no consent prompt:
//
//   - no advertising ID, no ad personalisation, no ad-network attribution
//     (firebase.json; app.json blocks the AD_ID permissions; iOS builds without
//     IDFA support — so no App Tracking Transparency prompt);
//   - automatic screen reporting is off: screens are logged here by ROUTE
//     PATTERN ("/note/[id]"), never with the id or a brain namespace in it;
//   - no user id, no user properties.
//
// Never pass note text, titles, tags, secret names or values, emails, brain
// names, search queries or URLs. logEvent enforces the shape: only numbers,
// booleans and short enum-like strings (no spaces) survive, under known keys.
//
// A build without Firebase config files makes every call a silent no-op.

type AnalyticsModule = typeof import("@react-native-firebase/analytics");
type Analytics = ReturnType<AnalyticsModule["getAnalytics"]>;
// Only reached once analytics() returned an instance, so the module is loaded.
const fa = () => rnfbAnalytics() as AnalyticsModule;
let instance: Analytics | null | undefined;

function analytics(): Analytics | null {
  if (instance === undefined) {
    try {
      const mod = rnfbAnalytics();
      instance = firebaseReady() && mod ? mod.getAnalytics() : null;
    } catch {
      instance = null;
    }
  }
  return instance;
}

/** Keys whose string values are allowed (enum-like: a method, a kind, a result). */
const STRING_KEYS = new Set(["method", "source", "kind", "type", "format", "result", "platform", "role", "locale", "screen", "theme", "mode", "state"]);
const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ENUM_VALUE = /^[A-Za-z0-9_.:/\[\]-]{1,40}$/;

export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

/** Keeps only non-personal parameter values (see the rule above). */
export function sanitizeParams(params: AnalyticsParams = {}): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!EVENT_NAME.test(key) || value === null || value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value ? 1 : 0;
    else if (typeof value === "string" && STRING_KEYS.has(key) && ENUM_VALUE.test(value)) out[key] = value;
  }
  return out;
}

/** A named product action, e.g. logEvent("note_create", { source: "editor" }). */
export function logEvent(name: string, params?: AnalyticsParams): void {
  const a = analytics();
  if (!a || !EVENT_NAME.test(name)) return;
  try {
    // Promise-returning in some SDK versions, void in others: swallow both ways.
    void Promise.resolve(fa().logEvent(a, name, sanitizeParams(params)) as unknown).catch(() => undefined);
  } catch {}
}

/**
 * The screen name for a route: expo-router segments with groups dropped and
 * dynamic segments kept as patterns — ["(tabs)","brains"] → "/brains",
 * ["note","[id]"] → "/note/[id]". Ids and namespaces never reach analytics.
 */
export function screenName(segments: readonly string[]): string {
  const parts = segments.filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
  return `/${parts.join("/")}`;
}

let lastScreen = "";

/** Logs a screen view (deduplicated: the same screen twice in a row is one view). */
export function logScreen(name: string): void {
  const screen = name.split(/[?#]/)[0].slice(0, 100) || "/";
  if (screen === lastScreen) return;
  lastScreen = screen;
  breadcrumb(`screen ${screen}`);
  const a = analytics();
  if (!a) return;
  try {
    void fa().logScreenView(a, { screen_name: screen, screen_class: screen }).catch(() => undefined);
  } catch {}
}

/**
 * Logs every navigation as a screen view. Mount once, inside the router (the
 * root layout's Shell). Uses the route's segments, not usePathname(), so the
 * logged name is "/note/[id]" and never a real note id.
 */
export function useScreenTracking(): void {
  const segments = useSegments();
  const name = screenName(segments);
  useEffect(() => {
    logScreen(name);
  }, [name]);
}

/** For a future in-app opt-out: turns collection off (persisted by Firebase). */
export function setAnalyticsEnabled(enabled: boolean): void {
  const a = analytics();
  if (!a) return;
  try {
    void fa().setAnalyticsCollectionEnabled(a, enabled).catch(() => undefined);
  } catch {}
}
