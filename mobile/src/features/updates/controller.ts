import * as Application from "expo-application";
import { getLocales } from "expo-localization";
import { Linking, Platform } from "react-native";

import { API_URL } from "@/lib/api";
import { getStored, setStored } from "@/lib/storage";

import { patch } from "./patch";
import { hasUnsavedWork } from "./unsaved-work";
import {
  defaultStoreUrl,
  dueForCheck,
  FOREGROUND_CHECK_EVERY_MS,
  parseItunesLookup,
  parseVersionManifest,
  pickLatest,
  planOta,
  RESUME_AFTER_BACKGROUND_MS,
  STORE_CHECK_EVERY_MS,
  storeDecision,
  type AppPlatform,
  type PlatformVersionInfo,
  type StoreDecision,
} from "./update-core";

/*
The updater (both kinds — see update-core.ts), as a tiny external store the
UI subscribes to (useUpdates). React-free so the flow reads top to bottom:

  startUpdates()     launch: confirm the running OTA bundle is good
                     (notifyAppReady — without it a new bundle rolls back on
                     the next launch), read which OTA release is running,
                     then check.
  onForeground()     throttled re-check (OTA every 30 min, store every 6 h).
  checkNow()         Settings ▸ About ▸ Check for updates (always checks).
  restartToUpdate()  the sheet's primary button.
  setEditing()       the note editor opened / closed (route guard).
  onBackground()     the app left the screen.

Everything is a no-op in development builds, on web, and in binaries built
without the Patch plugin (patch() === null); the store check is skipped in
development too.
*/

const DISMISSED_STORE_KEY = "zekra.updates.dismissedStore";
const MANIFEST_URL = `${API_URL}/zekra-app.json`;
const FETCH_TIMEOUT_MS = 8000;

export type OtaPhase = "idle" | "checking" | "downloading" | "ready" | "installing" | "up-to-date" | "error";

export interface UpdatesState {
  ota: {
    phase: OtaPhase;
    /** What the host shows: nothing, the sheet, or the full-screen loader. */
    ui: "none" | "sheet" | "blocking";
    label?: string;
    mandatory?: boolean;
    releaseNotes?: string | null;
    received?: number;
    total?: number;
    error?: string;
    checkedAt?: number;
    /** The OTA release running now (null = the bundle inside the binary). */
    running?: string | null;
  };
  store: {
    decision: StoreDecision;
    /** "prompt" shows the sheet once; "force" shows the gate. */
    ui: "none" | "prompt" | "force";
    storeUrl: string;
    message?: string;
    checkedAt?: number;
  };
}

let state: UpdatesState = {
  ota: { phase: "idle", ui: "none" },
  store: { decision: { kind: "none" }, ui: "none", storeUrl: "" },
};
const listeners = new Set<() => void>();

function set(next: { ota?: Partial<UpdatesState["ota"]>; store?: Partial<UpdatesState["store"]> }): void {
  state = {
    ota: next.ota ? { ...state.ota, ...next.ota } : state.ota,
    store: next.store ? { ...state.store, ...next.store } : state.store,
  };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): UpdatesState {
  return state;
}

const platform: AppPlatform | null = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;

/* ---------------------------------------------------------------- OTA */

let started = false;
let otaBusy = false;
let editing = false;
/** Restarts stay suppressed after the editor closed until the app is next
 *  backgrounded (only a mandatory update restarts right away). */
let holdUntilBackground = false;
const dismissedLabels = new Set<string>();

export async function startUpdates(): Promise<void> {
  if (started) return;
  started = true;
  const sdk = patch();
  if (sdk) {
    try {
      await sdk.notifyAppReady();
      const running = await sdk.getRunningBundleUpdateMetadata();
      set({ ota: { running: running?.label ?? null } });
    } catch (e) {
      console.warn("[updates] notifyAppReady failed:", e);
    }
  }
  await checkAll(true);
}

export function onForeground(): void {
  void checkAll(false);
}

/** Settings ▸ About. Resolves with what it found for the toast. */
export async function checkNow(): Promise<"unavailable" | "up-to-date" | "ota" | "store" | "error"> {
  const [ota] = await Promise.all([checkOta(true), checkStore(true)]);
  if (state.store.decision.kind !== "none") {
    // An explicit check shows the prompt again even if it was dismissed.
    set({ store: { ui: state.store.decision.kind === "force" ? "force" : "prompt" } });
    return "store";
  }
  return ota;
}

async function checkAll(force: boolean): Promise<void> {
  await Promise.all([checkOta(force), checkStore(force)]);
}

async function checkOta(force: boolean): Promise<"unavailable" | "up-to-date" | "ota" | "error"> {
  const sdk = patch();
  if (!sdk) return "unavailable";
  if (otaBusy) return "ota";
  if (state.ota.phase === "ready" || state.ota.phase === "installing") return "ota";
  if (!force && !dueForCheck(state.ota.checkedAt, Date.now(), FOREGROUND_CHECK_EVERY_MS)) return "up-to-date";
  otaBusy = true;
  set({ ota: { phase: "checking", error: undefined } });
  try {
    const result = await sdk.checkForUpdate();
    rememberPatchStoreHint(result.latestBinaryVersion, result.isStoreUpdateAvailable);
    if (result.action === "up-to-date") {
      set({ ota: { phase: "up-to-date", checkedAt: Date.now(), ui: "none" } });
      return "up-to-date";
    }
    if (result.action === "embedded-revert") {
      // The server rolled this binary back to its built-in bundle: apply on the next launch, quietly.
      await sdk.installUpdate(result, { installMode: "ON_NEXT_RESTART" });
      set({ ota: { phase: "up-to-date", checkedAt: Date.now(), ui: "none" } });
      return "up-to-date";
    }
    const pkg = result.remotePackage;
    if (pkg.previouslyFailed) {
      // This package crashed before and was rolled back: never retry it.
      set({ ota: { phase: "up-to-date", checkedAt: Date.now(), ui: "none" } });
      return "up-to-date";
    }
    const plan = planOta(pkg, { editing: hasUnsavedWork(), dismissedLabel: dismissedLabels.has(pkg.label) });
    set({
      ota: {
        phase: "downloading",
        ui: plan.ui === "silent" ? "none" : plan.ui,
        label: pkg.label,
        mandatory: pkg.isMandatory,
        releaseNotes: pkg.releaseNotes,
        received: 0,
        total: pkg.patchSize ?? pkg.fullBundleSize,
        checkedAt: Date.now(),
      },
    });
    const local = await sdk.downloadUpdate(pkg, (p) => set({ ota: { received: p.receivedBytes, total: p.totalBytes || state.ota.total } }));
    if (pkg.isMandatory) {
      // IMMEDIATE reloads inside installUpdate — unless restarts are
      // suppressed (the editor is open): then it waits for setEditing(false).
      const now = !hasUnsavedWork();
      if (now) {
        holdUntilBackground = false;
        sdk.allowRestart();
        set({ ota: { phase: "installing", ui: "blocking" } });
      } else {
        sdk.disallowRestart();
      }
      await sdk.installUpdate(local, { installMode: "IMMEDIATE" });
      // Normally unreachable when `now`: installUpdate already reloaded the app.
      if (now) await sdk.restartApp(true);
      set({ ota: { phase: "ready", ui: "none" } });
      return "ota";
    }
    await sdk.installUpdate(local, { installMode: "ON_NEXT_RESUME", minimumBackgroundDuration: RESUME_AFTER_BACKGROUND_MS });
    set({ ota: { phase: "ready" } });
    return "ota";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[updates] OTA check failed:", msg);
    set({ ota: { phase: "error", error: msg, ui: "none", checkedAt: Date.now() } });
    return "error";
  } finally {
    otaBusy = false;
  }
}

/** The sheet's "Restart to update". */
export async function restartToUpdate(): Promise<void> {
  const sdk = patch();
  if (!sdk) return;
  set({ ota: { phase: "installing", ui: "blocking" } });
  holdUntilBackground = false;
  sdk.allowRestart();
  await sdk.restartApp(true);
  // Still running: nothing was pending after all — never leave the loader up.
  set({ ota: { phase: "up-to-date", ui: "none" } });
}

/** "Later": the update still applies on the next resume after a while in the background. */
export function dismissOtaSheet(): void {
  if (state.ota.label) dismissedLabels.add(state.ota.label);
  set({ ota: { ui: "none" } });
}

/** The note editor opened / closed (UpdateHost, from the route). */
export function setEditing(next: boolean): void {
  if (next === editing) return;
  editing = next;
  const sdk = patch();
  if (!sdk) return;
  if (next) {
    sdk.disallowRestart();
    // The sheet never sits over the editor; the download carries on.
    if (state.ota.ui === "sheet") set({ ota: { ui: "none" } });
    return;
  }
  if (state.ota.mandatory && state.ota.phase === "ready") {
    // A mandatory update waited for the editor: the loader, then restart.
    set({ ota: { phase: "installing", ui: "blocking" } });
    setTimeout(() => sdk.allowRestart(), 350);
    return;
  }
  holdUntilBackground = true;
}

export function onBackground(): void {
  const sdk = patch();
  if (!sdk || editing) return;
  // The editor (if it was open) flushed its autosave on the way out, so a
  // restart can no longer lose anything: release the hold. A blocked
  // activation reloads now, invisibly; ON_NEXT_RESUME applies on return.
  if (holdUntilBackground) holdUntilBackground = false;
  sdk.allowRestart();
}

/* -------------------------------------------------------------- store */

let storeBusy = false;
let patchLatest: string | null = null;

function rememberPatchStoreHint(latest: string | null, available: boolean): void {
  if (available && latest) patchLatest = latest;
}

function installedVersion(): string | null {
  return Application.nativeApplicationVersion ?? null;
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function appStoreVersion(bundleId: string): Promise<{ version: string; storeUrl?: string } | null> {
  const region = getLocales()[0]?.regionCode?.toLowerCase();
  const base = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`;
  // The lookup is per storefront; the device's region first, then the default (US).
  for (const url of region ? [`${base}&country=${region}`, base] : [base]) {
    const hit = parseItunesLookup(await fetchJson(`${url}&_=${Date.now()}`));
    if (hit) return hit;
  }
  return null;
}

async function checkStore(force: boolean): Promise<void> {
  if (__DEV__ || !platform || storeBusy) return;
  if (!force && !dueForCheck(state.store.checkedAt, Date.now(), STORE_CHECK_EVERY_MS)) return;
  const installed = installedVersion();
  if (!installed) return;
  storeBusy = true;
  try {
    const appId = Application.applicationId ?? "com.fadymondy.zekra";
    const [manifestJson, ios] = await Promise.all([
      fetchJson(`${MANIFEST_URL}?_=${Date.now()}`),
      platform === "ios" ? appStoreVersion(appId) : Promise.resolve(null),
    ]);
    const manifest: PlatformVersionInfo = parseVersionManifest(manifestJson, platform);
    const latest = pickLatest(ios?.version, manifest.latestVersion, patchLatest);
    const dismissed = await getStored(DISMISSED_STORE_KEY);
    const decision = storeDecision({ installed, minimum: manifest.minimumVersion, latest, dismissedVersion: dismissed });
    const locale = getLocales()[0]?.languageCode === "ar" ? "ar" : "en";
    set({
      store: {
        decision,
        ui: decision.kind === "force" ? "force" : decision.kind === "prompt" ? "prompt" : "none",
        storeUrl: manifest.storeUrl ?? ios?.storeUrl ?? defaultStoreUrl(platform, appId),
        message: manifest.message?.[locale] ?? manifest.message?.en,
        checkedAt: Date.now(),
      },
    });
  } finally {
    storeBusy = false;
  }
}

export async function openStore(): Promise<void> {
  const url = state.store.storeUrl;
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch (e) {
    console.warn("[updates] could not open the store:", e);
  }
}

/** "Not now" on the store prompt: quiet until a newer store version appears. */
export function dismissStorePrompt(): void {
  const d = state.store.decision;
  if (d.kind === "prompt") void setStored(DISMISSED_STORE_KEY, d.version);
  set({ store: { ui: d.kind === "force" ? "force" : "none" } });
}
