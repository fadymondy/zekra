// Local, device-only settings store (electron-store -> a JSON file under
// app.getPath('userData')). Nothing in here is ever sent to the Zekra backend —
// it only configures *how* this desktop client talks to it (base URL, theme)
// and holds the signed-in session token so the renderer doesn't have to.
"use strict";

import Store from "electron-store";

export type ThemeId = "zekra-light" | "zekra-dark" | "zekra-gold";
export type LocaleId = "en" | "ar";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  roles?: string[];
}

export interface AppSettings {
  apiBaseUrl: string;
  theme: ThemeId;
  locale: LocaleId;
  activeBrain: string | null;
  // Session (token-based auth, mirroring mobile/src/providers/auth.tsx's
  // SecureStore-backed session — electron-store's on-disk JSON is the desktop
  // equivalent of that secure-storage seam).
  authToken: string | null;
  authUser: SessionUser | null;
}

const DEFAULTS: AppSettings = {
  apiBaseUrl: "https://app.zekra.dev",
  theme: "zekra-dark",
  locale: "en",
  activeBrain: null,
  authToken: null,
  authUser: null,
};

let store: Store<AppSettings> | null = null;

export function getStore(): Store<AppSettings> {
  if (!store) {
    store = new Store<AppSettings>({
      name: "zekra-desktop-settings",
      defaults: DEFAULTS,
    });
  }
  return store;
}

export function getSettings(): AppSettings {
  const s = getStore();
  return {
    apiBaseUrl: s.get("apiBaseUrl", DEFAULTS.apiBaseUrl),
    theme: s.get("theme", DEFAULTS.theme),
    locale: s.get("locale", DEFAULTS.locale),
    activeBrain: s.get("activeBrain", DEFAULTS.activeBrain),
    authToken: s.get("authToken", DEFAULTS.authToken),
    authUser: s.get("authUser", DEFAULTS.authUser),
  };
}

export function patchSettings(patch: Partial<AppSettings>): AppSettings {
  const s = getStore();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    s.set(key as keyof AppSettings, value as never);
  }
  return getSettings();
}

export function clearSession(): AppSettings {
  return patchSettings({ authToken: null, authUser: null });
}
