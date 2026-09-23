// Local, device-only settings (electron-store -> a JSON file under
// app.getPath("userData"), named zekra-desktop-settings.json). Nothing here is
// ever sent to the Zekra backend; it configures HOW this client talks to it.
//
// Schema: see AppSettings in src/shared/ipc.ts —
//   apiBaseUrl    string            API origin, no trailing slash
//   theme         system|light|dark drives nativeTheme.themeSource
//   locale        en|ar             UI + native menu language
//   activeBrain   string|null       last opened brain namespace
//   authUser      SessionUser|null  who is signed in (not secret)
//   windowBounds  WindowBounds|null owned by main (window-state.ts)
//   lock          LockSettings      app-lock placeholder (Touch ID)
//
// The session token is NOT stored in plain JSON. It is encrypted with
// Electron safeStorage (macOS: a key held in the login Keychain under
// "Zekra Safe Storage") and persisted as base64 under `authTokenEnc`. The
// decrypted value only exists in memory and in what getSettings() returns.
//
// Migration: builds before MH-450 wrote `authToken` in plain text. On first
// read after the app is ready it is encrypted, `authTokenEnc` is written and the
// plain key is deleted. Theme ids from the old theme system (zekra-light /
// zekra-dark / zekra-gold) map to light / dark / dark.
"use strict";

import { app, safeStorage } from "electron";
import Store from "electron-store";

import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type LockSettings,
  type SettingsPatch,
  type ThemeChoice,
  type WindowBounds,
} from "../shared/ipc";

/** What is actually on disk. */
interface StoredSettings {
  apiBaseUrl: string;
  theme: ThemeChoice | "zekra-light" | "zekra-dark" | "zekra-gold";
  locale: AppSettings["locale"];
  activeBrain: string | null;
  authUser: AppSettings["authUser"];
  windowBounds: WindowBounds | null;
  lock: LockSettings;
  /** safeStorage ciphertext, base64. */
  authTokenEnc?: string | null;
  /** Legacy plain-text token (pre MH-450), or the fallback when the OS offers
   *  no encryption (Linux without a keyring). */
  authToken?: string | null;
  /** True when authToken above is a deliberate plain-text fallback. */
  authTokenPlain?: boolean;
}

const { authToken: _t, ...STORED_DEFAULTS } = DEFAULT_SETTINGS;

let store: Store<StoredSettings> | null = null;
let tokenCache: { value: string | null } | null = null;

function getStore(): Store<StoredSettings> {
  if (!store) {
    store = new Store<StoredSettings>({
      name: "zekra-desktop-settings",
      defaults: STORED_DEFAULTS as StoredSettings,
    });
  }
  return store;
}

function canEncrypt(): boolean {
  // safeStorage is only usable after "ready".
  return app.isReady() && safeStorage.isEncryptionAvailable();
}

function normaliseTheme(t: StoredSettings["theme"] | undefined): ThemeChoice {
  if (t === "light" || t === "dark" || t === "system") return t;
  if (t === "zekra-light") return "light";
  return "dark";
}

function readToken(): string | null {
  if (tokenCache) return tokenCache.value;
  const s = getStore();
  const enc = s.get("authTokenEnc");
  let value: string | null = null;
  // Before "ready" the ciphertext cannot be read yet; answer null but do not
  // cache it, so the first read after ready sees the real session.
  if (enc && !canEncrypt()) return null;
  if (enc) {
    try {
      value = safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch (err) {
      // The Keychain key changed (e.g. a differently-signed build) — the
      // ciphertext is unreadable. Drop it; the user signs in again.
      console.warn("[zekra] could not decrypt the stored session; signing out", err);
      s.delete("authTokenEnc");
    }
  } else if (!enc) {
    value = s.get("authToken") ?? null;
  }
  tokenCache = { value };
  return value;
}

function writeToken(token: string | null): void {
  const s = getStore();
  tokenCache = { value: token };
  if (!token) {
    s.delete("authTokenEnc");
    s.delete("authToken");
    s.delete("authTokenPlain");
    return;
  }
  if (canEncrypt()) {
    s.set("authTokenEnc", safeStorage.encryptString(token).toString("base64"));
    s.delete("authToken");
    s.delete("authTokenPlain");
  } else {
    console.warn("[zekra] OS encryption unavailable; storing the session token unencrypted");
    s.set("authToken", token);
    s.set("authTokenPlain", true);
  }
}

/** One-time upgrades. Call once, after app "ready". */
export function migrateSettings(): void {
  const s = getStore();
  const legacy = s.get("authToken");
  if (legacy && !s.get("authTokenEnc") && canEncrypt()) {
    writeToken(legacy);
    console.log("[zekra] migrated the session token into safeStorage");
  }
  const theme = s.get("theme");
  const normalised = normaliseTheme(theme);
  if (theme !== normalised) s.set("theme", normalised);
  if (!s.get("lock")) s.set("lock", DEFAULT_SETTINGS.lock);
}

export function getSettings(): AppSettings {
  const s = getStore();
  return {
    apiBaseUrl: s.get("apiBaseUrl", DEFAULT_SETTINGS.apiBaseUrl),
    theme: normaliseTheme(s.get("theme")),
    locale: s.get("locale", DEFAULT_SETTINGS.locale),
    activeBrain: s.get("activeBrain", DEFAULT_SETTINGS.activeBrain),
    authToken: readToken(),
    authUser: s.get("authUser", DEFAULT_SETTINGS.authUser),
    windowBounds: s.get("windowBounds", null),
    lock: { ...DEFAULT_SETTINGS.lock, ...(s.get("lock") ?? {}) },
  };
}

export function patchSettings(patch: SettingsPatch): AppSettings {
  const s = getStore();
  for (const [key, value] of Object.entries(patch) as [keyof SettingsPatch, unknown][]) {
    if (value === undefined) continue;
    if (key === "authToken") {
      writeToken((value as string | null) ?? null);
      continue;
    }
    if (key === "apiBaseUrl") {
      s.set("apiBaseUrl", String(value).replace(/\/+$/, ""));
      continue;
    }
    s.set(key, value as never);
  }
  return getSettings();
}

export function clearSession(): AppSettings {
  return patchSettings({ authToken: null, authUser: null });
}

export function getWindowBounds(): WindowBounds | null {
  return getStore().get("windowBounds", null);
}

export function setWindowBounds(bounds: WindowBounds): void {
  getStore().set("windowBounds", bounds);
}
