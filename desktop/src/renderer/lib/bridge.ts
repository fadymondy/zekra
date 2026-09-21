// The preload bridge (src/main/preload.ts) and the local settings store.
// Nothing here ever reaches the Zekra backend — it only configures how this
// client talks to it and holds the signed-in session.

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
  authToken: string | null;
  authUser: SessionUser | null;
}

export type MenuChannel = "new-note" | "save-note" | "sign-out" | "settings" | "about";

export interface ZekraBridge {
  getSettings(): Promise<AppSettings>;
  patchSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  clearSession(): Promise<AppSettings>;
  getVersion(): Promise<string>;
  openExternal(url: string): Promise<void>;
  onMenu(channel: MenuChannel, cb: () => void): () => void;
}

declare global {
  interface Window {
    zekra: ZekraBridge;
  }
}

const PREVIEW_KEY = "zekra-desktop-preview-settings";

const DEFAULTS: AppSettings = {
  apiBaseUrl: "https://app.zekra.dev",
  theme: "zekra-dark",
  locale: "en",
  activeBrain: null,
  authToken: null,
  authUser: null,
};

// Outside Electron (the web preview) there is no preload bridge. Back the same
// interface with localStorage so the renderer runs unchanged in a browser.
// This is a preview affordance only — the shipped app always has window.zekra.
function previewBridge(): ZekraBridge {
  const read = (): AppSettings => {
    try {
      const raw = localStorage.getItem(PREVIEW_KEY);
      return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as AppSettings) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  };
  const write = (s: AppSettings) => {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(s));
    } catch {}
    return s;
  };
  return {
    async getSettings() { return read(); },
    async patchSettings(patch) { return write({ ...read(), ...patch }); },
    async clearSession() { return write({ ...read(), authToken: null, authUser: null }); },
    async getVersion() { return "web-preview"; },
    async openExternal(url) { window.open(url, "_blank", "noopener"); },
    onMenu() { return () => {}; },
  };
}

let fallback: ZekraBridge | null = null;

export const bridge = (): ZekraBridge => {
  if (window.zekra) return window.zekra;
  fallback ??= previewBridge();
  return fallback;
};
