// Access to `window.zekra` (src/main/preload.ts). The contract — every method,
// event and payload — is declared once in src/shared/ipc.ts; this module only
// re-exports it and supplies a browser fallback.
//
// Outside Electron (opening out/renderer in a browser for a quick preview)
// there is no preload. previewBridge() backs the same interface with
// localStorage + fetch + no-ops so the renderer still runs. It is a preview
// affordance only; the shipped app always has window.zekra.

import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BinaryResponse,
  type SettingsPatch,
  type ZekraBridge,
} from "../../shared/ipc";

export type {
  AppInfo,
  AppSettings,
  CommandEvent,
  CommandName,
  DeepLinkEvent,
  LocaleId,
  NotificationClickEvent,
  OpenFileEvent,
  ProxyRequest,
  ProxyResponse,
  SessionUser,
  SettingsPatch,
  ThemeChoice,
  UpdateState,
  WindowStateEvent,
  ZekraBridge,
} from "../../shared/ipc";

declare global {
  interface Window {
    zekra?: ZekraBridge;
  }
}

const PREVIEW_KEY = "zekra-desktop-preview-settings";

function previewBridge(): ZekraBridge {
  const read = (): AppSettings => {
    try {
      const raw = localStorage.getItem(PREVIEW_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as AppSettings) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };
  const write = (s: AppSettings) => {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(s));
    } catch {}
    return s;
  };
  const none = () => () => {};
  return {
    async getSettings() { return read(); },
    async patchSettings(patch: SettingsPatch) { return write({ ...read(), ...patch }); },
    async clearSession() { return write({ ...read(), authToken: null, authUser: null }); },
    async getAppInfo() {
      return { version: "web-preview", platform: "browser", arch: "", isPackaged: false, windowControls: { side: "left", inset: 0 } };
    },
    async getVersion() { return "web-preview"; },
    async openExternal(url) { window.open(url, "_blank", "noopener"); },
    async rendererReady() {},
    async showAboutPanel() {},
    // No main process here, so this is a plain fetch; the preview has a real
    // origin on the API's allow-list, so CORS is satisfied.
    async apiRequest(req) {
      let body: BodyInit | undefined;
      const headers = { ...req.headers };
      if (req.file) {
        const form = new FormData();
        for (const [k, v] of Object.entries(req.file.fields)) form.append(k, v);
        form.append(req.file.field, new Blob([req.file.bytes as BlobPart], { type: req.file.contentType }), req.file.filename);
        body = form;
        delete headers["Content-Type"];
      } else if (req.body !== undefined) {
        body = req.body;
      }
      const res = await fetch(`${req.baseUrl}${req.path}`, { method: req.method, headers, body, credentials: "include" });
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => { out[k] = v; });
      return { status: res.status, headers: out, body: await res.text() };
    },
    async apiBinary(pathOrUrl): Promise<BinaryResponse> {
      const s = read();
      const res = await fetch(new URL(pathOrUrl, s.apiBaseUrl), {
        headers: s.authToken ? { Authorization: `Bearer ${s.authToken}`, "X-Agent-Id": "zekra-desktop" } : {},
        credentials: "include",
      });
      if (!res.ok) return { ok: false, status: res.status, contentType: "", bytes: null };
      return { ok: true, status: res.status, contentType: res.headers.get("content-type") ?? "", bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    async saveFile(req) {
      const data = req.text ?? (req.bytes ? new Blob([req.bytes as BlobPart]) : req.base64 ? Uint8Array.from(atob(req.base64), (c) => c.charCodeAt(0)) : "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart]));
      a.download = req.suggestedName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return { canceled: false };
    },
    async openFile() { return { canceled: true, files: [] }; },
    async confirm(req) { return { response: window.confirm(req.message) ? (req.defaultId ?? 0) : (req.cancelId ?? 1) }; },
    async printToPdf() { throw new Error("PDF export needs the desktop app"); },
    async notify(req) { console.info("[notify]", req.title, req.body); },
    async canPromptTouchId() { return false; },
    async promptTouchId() { return { ok: false, error: "unavailable" }; },
    async writeClipboardText(text) { await navigator.clipboard.writeText(text); },
    async writeSecretText(text) { await navigator.clipboard.writeText(text); }, // MH-450 vault: no timed wipe in the preview
    async setDocumentEdited() {},
    async closeWindow() {},
    async checkForUpdates() { return { status: "disabled" }; },
    async getUpdateState() { return { status: "disabled" }; },
    async installUpdate() { return false; },
    async setTrayStatus() {},
    // MH-450: no Dock or local AI-tool configs in the browser preview.
    async setBadgeCount() {},
    async installMcp() { return { status: "error", message: "Only available in the desktop app" }; },
    async getMcpStatus() { return { claude: false, cursor: false }; },
    onCommand: none,
    onDeepLink: none,
    onOpenFile: none,
    onNotificationClick: none,
    onSystemThemeChanged: none,
    onWindowState: none,
    onUpdateState: none,
    onAppActivity: none, // MH-450 app lock
  };
}

let fallback: ZekraBridge | null = null;

export const bridge = (): ZekraBridge => {
  if (window.zekra) return window.zekra;
  fallback ??= previewBridge();
  return fallback;
};

export const isDesktop = (): boolean => Boolean(window.zekra);
