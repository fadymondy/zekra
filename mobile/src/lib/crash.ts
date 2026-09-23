import * as Application from "expo-application";
import Constants from "expo-constants";
import { getLocales } from "expo-localization";
import type { ErrorBoundaryProps } from "expo-router";
import { createElement, useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { ToastHost } from "@/components/kit";
import { PrimaryButton, SecondaryButton, StatePanel } from "@/components/ui";
import { addCrumb, installDiagnostics, noteError } from "@/features/mahaam/diagnostics";
import { captureError, initMonitor } from "@/features/mahaam/monitor";
import { ReportSheet, type ReportRequest } from "@/features/mahaam/report-sheet";
import { rnfbApp, rnfbCrashlytics } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n";
import { usePalette } from "@/theme";

// Crash reporting (MH-373), ported from fadymondy.com/mobile/src/lib/crash.ts.
//
// Everything that reaches Crashlytics goes through this file, so the rule about
// what may be sent lives in one place: screen names, API method + path + status,
// build identifiers. NEVER note text, secret names or values, emails, tokens or
// query strings — a crash reporter fed carelessly is an exfiltration path, and it
// is declared data collection in both stores (app.json privacyManifests; the Play
// data-safety form in docs/mobile-release.md). No user id is set: crash data is
// declared "not linked to the user".
//
// Native crashes and unhandled JS exceptions are captured by Crashlytics itself
// (firebase.json); this adds the render errors React swallows (ErrorBoundary)
// and breadcrumbs.
//
// Mahaam (src/features/mahaam): breadcrumbs and handled errors also fan out to
// the in-memory diagnostics a "Report a problem" attaches, and to Mahaam error
// monitoring when EXPO_PUBLIC_MAHAAM_DSN is set (off otherwise). Crashlytics
// keeps native crashes; Mahaam gets JS errors as issues on the Zekra board.
//
// A build without the Firebase config files has no native default app: every
// call here is then a silent no-op, never a crash (firebaseReady()).

let ready: boolean | undefined;

/** True when this build has a configured native Firebase app. */
export function firebaseReady(): boolean {
  if (ready === undefined) {
    try {
      // getApp() throws without a native default app; getApps() just lists none.
      const app = rnfbApp();
      ready = Platform.OS !== "web" && !!app && app.getApps().length > 0;
    } catch {
      ready = false;
    }
  }
  return ready;
}

type CrashlyticsModule = typeof import("@react-native-firebase/crashlytics");
type Crashlytics = ReturnType<CrashlyticsModule["getCrashlytics"]>;
// Only reached once crashlytics() returned an instance, so the module is loaded.
const fc = () => rnfbCrashlytics() as CrashlyticsModule;
let instance: Crashlytics | null | undefined;

function crashlytics(): Crashlytics | null {
  if (instance === undefined) {
    try {
      const mod = rnfbCrashlytics();
      instance = firebaseReady() && mod ? mod.getCrashlytics() : null;
    } catch {
      instance = null;
    }
  }
  return instance;
}

/** Query strings and fragments can carry secrets (tokens, one-time links): never log them. */
export function safePath(path: string): string {
  return path.split(/[?#]/)[0];
}

/** Strips query strings from anything URL-like inside free text, and caps its length. */
function scrub(text: string): string {
  return text.replace(/\?[^\s]*/g, "").slice(0, 200);
}

let initialised = false;

/**
 * Build identifiers on every report, so a report traces to a build. Call once,
 * at module load of the app entry (app/_layout.tsx). Idempotent.
 */
export function initCrashReporting(): void {
  if (initialised) return;
  initialised = true;
  installDiagnostics();
  initMonitor();
  const c = crashlytics();
  if (!c) return;
  const cfg = Constants.expoConfig;
  const build = Application.nativeBuildVersion ?? String((Platform.OS === "android" ? cfg?.android?.versionCode : cfg?.ios?.buildNumber) ?? "local");
  let locale = "unknown";
  try {
    locale = getLocales()[0]?.languageTag ?? "unknown";
  } catch {}
  void fc().setAttributes(c, {
    build_type: __DEV__ ? "debug" : "release",
    app_version: Application.nativeApplicationVersion ?? cfg?.version ?? "unknown",
    build_number: build,
    platform: `${Platform.OS} ${Platform.Version}`,
    locale,
  }).catch(() => undefined);
}

/** A short, non-personal trail line ("open note", "api GET /api/notes 500"). */
export function breadcrumb(message: string): void {
  addCrumb(scrub(message));
  const c = crashlytics();
  if (!c) return;
  try {
    fc().log(c, scrub(message));
  } catch {}
}

/** Records a handled error. `context` is a short label, never user content. */
export function reportError(error: unknown, context?: string): void {
  if (__DEV__) console.warn(context ? `[${context}]` : "[error]", error);
  else noteError(error, context);
  captureError(error, "error", context);
  const c = crashlytics();
  if (!c) return;
  try {
    const err = error instanceof Error ? error : new Error(scrub(String(error)));
    if (context) fc().log(c, `context: ${scrub(context)}`);
    fc().recordError(c, err);
  } catch {}
}

export function crashReportingAvailable(): boolean {
  return crashlytics() !== null;
}

/**
 * expo-router error boundary: re-export it from a route or layout
 * (`export { ErrorBoundary } from "@/lib/crash"`) and a render error there is
 * reported, then replaced by a retry panel instead of a white screen.
 *
 * At the root it renders outside the app's providers, so it only uses what has
 * safe defaults (palette → light, i18n → English).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const p = usePalette();
  const { t } = useI18n();
  const [reporting, setReporting] = useState(false);
  // Stable per error, so the open sheet is not reset by a re-render.
  const [request, setRequest] = useState<ReportRequest>({});
  useEffect(() => {
    reportError(error, "render");
    setRequest({ kind: "bug", error: { message: String(error?.message ?? error), stack: error?.stack } });
  }, [error]);
  return createElement(
    View,
    { style: { flex: 1, backgroundColor: p.bg, justifyContent: "center", padding: 28 } },
    createElement(StatePanel, {
      title: t("kit.error"),
      action: createElement(
        View,
        { style: { gap: 10 } },
        createElement(PrimaryButton, { label: t("kit.retry"), onPress: () => void retry() }),
        // Offer to file it on the Mahaam board, pre-filled with the error and its stack.
        createElement(SecondaryButton, { label: t("mahaam.reportCrash"), onPress: () => setReporting(true) }),
      ),
    }),
    createElement(ReportSheet, { open: reporting, onClose: () => setReporting(false), request }),
    // At the root the Shell (and its ToastHost) is gone; the sheet's "Sent as MG-n" needs one.
    createElement(ToastHost),
  );
}
