// The only bridge between the sandboxed renderer and Node/Electron internals.
// contextIsolation + sandbox stay on (see main.ts); no remote content is ever
// loaded, so this surface only needs to (a) read/write local settings and the
// session token, and (b) relay native menu clicks. All Zekra API calls happen
// via `fetch` directly in the renderer (see src/renderer/renderer.ts) — the
// backend never goes through IPC.
"use strict";

import { contextBridge, ipcRenderer } from "electron";
import type { ProxyRequest, ProxyResponse } from "./api-proxy";
import type { AppSettings } from "./settings-store";

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("zekra:settings:get"),
  patchSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke("zekra:settings:patch", patch),
  clearSession: (): Promise<AppSettings> => ipcRenderer.invoke("zekra:settings:clear-session"),
  getVersion: (): Promise<string> => ipcRenderer.invoke("zekra:app:version"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("zekra:app:open-external", url),
  apiRequest: (req: ProxyRequest): Promise<ProxyResponse> => ipcRenderer.invoke("zekra:api:request", req),

  onMenu: (channel: "new-note" | "save-note" | "sign-out" | "settings" | "about", cb: () => void): (() => void) => {
    const wire = `zekra:menu:${channel}`;
    const handler = () => cb();
    ipcRenderer.on(wire, handler);
    return () => ipcRenderer.removeListener(wire, handler);
  },
};

export type ZekraBridge = typeof api;

contextBridge.exposeInMainWorld("zekra", api);
