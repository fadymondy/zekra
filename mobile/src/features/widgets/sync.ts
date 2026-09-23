import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";

import type { BrainDetail, BrainListItem, BrainStats } from "@/features/brains/brains-core";
import { ApiError, request, type Brain } from "@/lib/api";
import { getStored } from "@/lib/storage";

import { ANDROID_WIDGET_NAMES, renderAndroidWidget } from "./android-widgets";
import type { updateIosWidget as UpdateIosWidget } from "./brains-widget";
import { helpers, widgetLabels } from "./labels";
import { readSnapshot, writeSnapshot } from "./store";
import {
  buildSnapshot,
  buildTimeline,
  buildWidgetProps,
  snapshotFingerprint,
  type WidgetLocale,
  type WidgetSnapshot,
  type WidgetSourceData,
} from "./widgets-core";

// Snapshot → widgets. Everything here is safe to run headless (no React tree,
// no router): the Android widget task and the FCM background handler use it.
//
// iOS gets a timeline (buildTimeline): the widget extension cannot fetch, so
// the "3h ago" labels are pre-rendered for the next six hours. Android renders
// once; its widget task re-renders on the provider's update period.

// The iOS widget module declares the widget at import (expo-widgets'
// createWidget), which throws in a binary without the ExpoWidgets native
// module — and this file loads at the app entry. So it is required on first
// use, and a binary without widgets simply skips them instead of failing to
// start.
let iosWidget: typeof UpdateIosWidget | null | undefined;
function loadIosWidget(): typeof UpdateIosWidget | null {
  if (iosWidget === undefined) {
    try {
      iosWidget = (require("./brains-widget") as { updateIosWidget: typeof UpdateIosWidget }).updateIosWidget;
    } catch {
      iosWidget = null;
    }
  }
  return iosWidget;
}

let lastFingerprint = "";
let lastPushAt = 0;
const REPUSH_AFTER_MS = 5 * 60_000;

/** Hand `snapshot` to the platform's widgets (and reload them). */
export async function pushSnapshot(snapshot: WidgetSnapshot, now: number = Date.now()): Promise<void> {
  const labels = widgetLabels(snapshot.locale);
  if (Platform.OS === "ios") {
    loadIosWidget()?.(buildTimeline(snapshot, labels, helpers, now));
  } else if (Platform.OS === "android") {
    const props = buildWidgetProps(snapshot, labels, helpers, now);
    await Promise.all(
      ANDROID_WIDGET_NAMES.map((widgetName) =>
        requestWidgetUpdate({ widgetName, renderWidget: (info) => renderAndroidWidget(widgetName, props, info) }).catch(() => undefined),
      ),
    );
  }
}

/**
 * Build a snapshot from what the app has, persist it, and update the widgets.
 * Identical data is pushed at most every five minutes (WidgetKit budgets
 * reloads); pass `force` to push anyway. Never throws.
 */
export async function syncWidgets(data: WidgetSourceData, opts: { force?: boolean } = {}): Promise<WidgetSnapshot | null> {
  try {
    const snapshot = buildSnapshot(data, helpers);
    const fp = snapshotFingerprint(snapshot);
    const now = Date.now();
    if (!opts.force && fp === lastFingerprint && now - lastPushAt < REPUSH_AFTER_MS) return snapshot;
    writeSnapshot(snapshot);
    await pushSnapshot(snapshot, now);
    lastFingerprint = fp;
    lastPushAt = now;
    return snapshot;
  } catch {
    return null;
  }
}

// ─── Headless fetch ─────────────────────────────────────────────────────────
// These keys belong to other modules (src/providers/auth.tsx SESSION_KEY,
// src/lib/i18n.tsx STORE_KEY, src/providers/brains.tsx BRAIN_KEY) and are not
// exported; keep them in step.
const SESSION_KEY = "zekra.mobile.session.v1";
const LOCALE_KEY = "zekra.locale";
const PINNED_KEY = "zekra.mobile.brain.v1";

async function storedLocale(): Promise<WidgetLocale> {
  return (await getStored(LOCALE_KEY)) === "ar" ? "ar" : "en";
}

async function storedToken(): Promise<string | null> {
  try {
    const raw = await getStored(SESSION_KEY);
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    return token || null;
  } catch {
    return null;
  }
}

function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return run(ctl.signal).finally(() => clearTimeout(timer));
}

/**
 * Fetch a fresh snapshot with the stored session: /api/brain/mine (required),
 * /namespaces (lastAt), /stats, and the pinned brain's detail. Returns a
 * signed-out snapshot when there is no session or it was rejected (401), and
 * null when the server could not be reached (keep what the widgets show).
 */
export async function fetchSnapshot(timeoutMs = 12_000): Promise<WidgetSnapshot | null> {
  const locale = await storedLocale();
  const token = await storedToken();
  if (!token) return buildSnapshot({ signedIn: false, locale }, helpers);
  return withTimeout(timeoutMs, async (signal) => {
    const get = <T>(path: string) => request<T>(path, { token, signal });
    const [mine, namespaces, stats] = await Promise.allSettled([
      get<{ brains: Brain[] }>("/api/brain/mine"),
      get<{ brains?: BrainListItem[] }>("/api/brain/namespaces"),
      get<BrainStats>("/api/brain/stats"),
    ]);
    if (mine.status === "rejected") {
      if (mine.reason instanceof ApiError && mine.reason.status === 401) return buildSnapshot({ signedIn: false, locale }, helpers);
      return null;
    }
    const base: WidgetSourceData = {
      signedIn: true,
      locale,
      mine: mine.value.brains as BrainListItem[],
      namespaces: namespaces.status === "fulfilled" ? namespaces.value.brains : undefined,
      stats: stats.status === "fulfilled" ? stats.value : null,
      pinnedNamespace: await getStored(PINNED_KEY),
    };
    // Which brain the small widget shows is decided by the snapshot (last
    // opened, else most recent); then fetch that one's recalls and gaps.
    const pinned = buildSnapshot(base, helpers).pinned?.namespace;
    let pinnedDetail: BrainDetail | null = null;
    if (pinned) {
      pinnedDetail = await get<BrainDetail>(`/api/brain/brain?namespace=${encodeURIComponent(pinned)}`).catch(() => null);
    }
    return buildSnapshot({ ...base, pinnedNamespace: pinned, pinnedDetail }, helpers);
  }).catch(() => null);
}

/**
 * Refresh the widgets while the app is not in the foreground — call it from
 * the FCM background message handler (src/features/push/background.ts). It
 * reads the session the app stored, fetches, persists and pushes. Never throws.
 */
export async function refreshWidgetsInBackground(): Promise<void> {
  try {
    const fresh = await fetchSnapshot();
    if (!fresh) return;
    writeSnapshot(fresh);
    await pushSnapshot(fresh);
    lastFingerprint = snapshotFingerprint(fresh);
    lastPushAt = Date.now();
  } catch {
    // A background refresh must never crash the headless task.
  }
}

/** The last persisted snapshot (for the Android widget task). */
export { readSnapshot };
