/*
App updates — the pure decisions (unit-tested in update-core.test.ts; no React
Native imports, so node --test runs it directly).

Two kinds of update:

  OTA (Codemagic Patch)  a new JS bundle for the SAME native binary. Checked on
                         launch and on foreground (throttled). planOta() says
                         how to apply it:
                           mandatory (the release's "mandatory" flag on the
                           Patch server) -> full-screen loader, install
                           IMMEDIATE, restart — unless the note editor is
                           open, then it downloads quietly and restarts the
                           moment the editor closes;
                           otherwise -> the update sheet ("downloading…",
                           then Restart to update / Later), installed
                           ON_NEXT_RESUME so it applies by itself after the
                           app has been in the background for a while.
  Store (native binary)  a new version in the App Store / Play. storeDecision()
                         compares the installed native version with:
                           - minimumVersion from the app-version manifest
                             (GET <API origin>/zekra-app.json) -> FORCE gate
                             when below it;
                           - the newest store version (iOS: the iTunes lookup
                             API; Android / fallback: latestVersion from the
                             manifest, or the Patch server's latest binary
                             version) -> a dismissible prompt, once per version.
*/

/* ------------------------------------------------------------ versions */

/** "v1.2.3-beta.1+45" -> { nums: [1,2,3], pre: "beta.1" }; null when not a version. */
export function parseVersion(v: string | null | undefined): { nums: number[]; pre: string } | null {
  if (!v) return null;
  const m = /^\s*v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(v);
  if (!m) return null;
  return { nums: m[1].split(".").map((n) => Number(n)), pre: m[2] ?? "" };
}

/** <0, 0, >0 like a comparator; null when either side is not a version. A
 *  pre-release sorts before its release (1.2.0-beta < 1.2.0). */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  const len = Math.max(x.nums.length, y.nums.length);
  for (let i = 0; i < len; i += 1) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function isOlder(installed: string | null | undefined, than: string | null | undefined): boolean {
  const c = compareVersions(installed, than);
  return c !== null && c < 0;
}

/* ---------------------------------------------------- version manifest */

export type AppPlatform = "ios" | "android";

/** One platform's entry of the app-version manifest (zekra-app.json). */
export interface PlatformVersionInfo {
  /** Below this the app is blocked until updated from the store. */
  minimumVersion?: string;
  /** The newest store version (Android has no public lookup API). */
  latestVersion?: string;
  /** Where "Open Store" goes; defaults per platform. */
  storeUrl?: string;
  /** Optional words for the force gate, per locale. */
  message?: { en?: string; ar?: string };
}

/**
 * The manifest is served by the web app as a static file (web/public/zekra-app.json):
 *
 *   { "ios": { "minimumVersion": "0.1.0", "latestVersion": "0.2.0" },
 *     "android": { "minimumVersion": "0.1.0", "latestVersion": "0.2.0" } }
 *
 * Anything malformed yields {} — a broken manifest must never lock users out.
 */
export function parseVersionManifest(json: unknown, platform: AppPlatform): PlatformVersionInfo {
  if (!json || typeof json !== "object") return {};
  const entry = (json as Record<string, unknown>)[platform];
  if (!entry || typeof entry !== "object") return {};
  const e = entry as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const out: PlatformVersionInfo = {};
  if (parseVersion(str(e.minimumVersion))) out.minimumVersion = str(e.minimumVersion);
  if (parseVersion(str(e.latestVersion))) out.latestVersion = str(e.latestVersion);
  const url = str(e.storeUrl);
  if (url && /^(https:|itms-apps:|market:)/.test(url)) out.storeUrl = url;
  if (e.message && typeof e.message === "object") {
    const m = e.message as Record<string, unknown>;
    out.message = { en: str(m.en), ar: str(m.ar) };
  }
  return out;
}

/** https://itunes.apple.com/lookup?bundleId=… -> the App Store version. */
export function parseItunesLookup(json: unknown): { version: string; storeUrl?: string; releaseNotes?: string } | null {
  if (!json || typeof json !== "object") return null;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || !results.length) return null;
  const r = results[0] as Record<string, unknown>;
  const version = typeof r.version === "string" ? r.version : "";
  if (!parseVersion(version)) return null;
  return {
    version,
    storeUrl: typeof r.trackViewUrl === "string" ? r.trackViewUrl : undefined,
    releaseNotes: typeof r.releaseNotes === "string" ? r.releaseNotes : undefined,
  };
}

export const IOS_APP_STORE_FALLBACK = "https://apps.apple.com/search?term=Zekra";
export function defaultStoreUrl(platform: AppPlatform, appId: string): string {
  return platform === "android" ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}` : IOS_APP_STORE_FALLBACK;
}

/* ------------------------------------------------------ store decision */

export type StoreDecision =
  | { kind: "none" }
  | { kind: "prompt"; version: string }
  | { kind: "force"; minimum: string; version?: string };

export function storeDecision(input: {
  installed: string | null | undefined;
  minimum?: string;
  latest?: string | null;
  /** The store version the user already said "Not now" to. */
  dismissedVersion?: string | null;
}): StoreDecision {
  const { installed, minimum, latest, dismissedVersion } = input;
  if (!parseVersion(installed)) return { kind: "none" };
  if (minimum && isOlder(installed, minimum)) return { kind: "force", minimum, version: latest ?? undefined };
  if (latest && isOlder(installed, latest) && dismissedVersion !== latest) return { kind: "prompt", version: latest };
  return { kind: "none" };
}

/** Newest known store version: the platform's own answer first, then the
 *  manifest, then the Patch server's latest binary version. */
export function pickLatest(...candidates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const c of candidates) {
    if (!parseVersion(c)) continue;
    if (!best || (compareVersions(c, best) ?? 0) > 0) best = c as string;
  }
  return best;
}

/* -------------------------------------------------------- OTA decision */

export type InstallMode = "IMMEDIATE" | "ON_NEXT_RESTART" | "ON_NEXT_RESUME" | "ON_NEXT_SUSPEND";

/** How long the app must stay in the background before a non-mandatory
 *  update applies on resume (a quick app switch never reloads it). */
export const RESUME_AFTER_BACKGROUND_MS = 10 * 60 * 1000;

export interface OtaPlan {
  installMode: InstallMode;
  /** "blocking" = the full-screen loader; "sheet" = the update sheet;
   *  "silent" = nothing on screen (the editor is open). */
  ui: "blocking" | "sheet" | "silent";
  /** Restart right after installing (mandatory, nothing open to lose). */
  restartNow: boolean;
}

export function planOta(pkg: { isMandatory: boolean }, ctx: { editing: boolean; dismissedLabel?: boolean }): OtaPlan {
  if (pkg.isMandatory) {
    // IMMEDIATE with restarts suppressed (editing) waits for allowRestart().
    return { installMode: "IMMEDIATE", ui: ctx.editing ? "silent" : "blocking", restartNow: !ctx.editing };
  }
  return { installMode: "ON_NEXT_RESUME", ui: ctx.editing || ctx.dismissedLabel ? "silent" : "sheet", restartNow: false };
}

/* ------------------------------------------------------------- helpers */

/** Foreground checks at most this often (launch always checks). */
export const FOREGROUND_CHECK_EVERY_MS = 30 * 60 * 1000;
export const STORE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function dueForCheck(lastAt: number | null | undefined, now: number, everyMs: number): boolean {
  return !lastAt || now - lastAt >= everyMs;
}

/** 0..1 for a progress bar; null when the total is unknown. */
export function progressFraction(received: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(1, Math.max(0, received / total));
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v.toFixed(i === 0 || v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** The route of the note editor (app/(tabs)/(brains)/note/[id].tsx). */
export function isEditorRoute(pathname: string | null | undefined): boolean {
  return /(^|\/)note\/[^/]+/.test(pathname ?? "");
}
