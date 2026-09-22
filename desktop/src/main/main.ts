// Zekra desktop — native Electron app entry point.
//
// This is a real client of the Zekra brain/notes REST API, not a browser
// wrapper around app.zekra.dev: the only thing ever loaded into the
// BrowserWindow is this app's own bundled renderer HTML/JS
// (out/renderer/index.html).
//
// Backend calls are made HERE, not in the renderer — see api-proxy.ts. A
// file:// renderer sends Origin: null, which the API rejects by design, so a
// packaged build could otherwise reach nothing (MH-269).
"use strict";

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import * as path from "node:path";
import { proxyRequest, type ProxyRequest } from "./api-proxy";
import { APP_NAME, APP_NAME_AR, installMenu } from "./menu";
import { clearSession, getSettings, patchSettings, type AppSettings } from "./settings-store";

app.setAppUserModelId("dev.zekra.desktop");
app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;

function rendererIndexPath(): string {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 560,
    title: APP_NAME,
    // Zekra's dark-theme ink token (web/app/styles/grid-tokens.css --grid-bg
    // under [data-theme="dark"]) so the window doesn't flash white on boot.
    backgroundColor: "#0b1429",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Only ever load this app's own bundled renderer file. No remote loadURL.
  void win.loadFile(rendererIndexPath());

  // Any window.open()/target=_blank goes to the OS browser, never a second
  // Electron window pointed at a remote origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Guard against any accidental top-level navigation away from the local
  // renderer bundle (defense in depth — the renderer never navigates itself).
  win.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.protocol !== "file:") {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: `${APP_NAME} (${APP_NAME_AR})`,
    });
  }
  installMenu();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC: local settings/session store (never sent to the backend) --------

ipcMain.handle("zekra:settings:get", (): AppSettings => getSettings());

ipcMain.handle("zekra:settings:patch", (_e, patch: Partial<AppSettings>): AppSettings => patchSettings(patch));

ipcMain.handle("zekra:settings:clear-session", (): AppSettings => clearSession());

ipcMain.handle("zekra:app:version", (): string => app.getVersion());

ipcMain.handle("zekra:app:open-external", async (_e, url: string): Promise<void> => {
  const parsed = new URL(url);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    await shell.openExternal(url);
  }
});

// ---- IPC: backend calls, proxied out of the renderer (MH-269) -------------
//
// The renderer runs from file:// and so sends Origin: null, which the API
// rejects on purpose. net.request runs here, where CORS does not apply.
ipcMain.handle("zekra:api:request", async (_e, req: ProxyRequest) => proxyRequest(req));

nativeTheme.on("updated", () => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("zekra:system-theme-changed", nativeTheme.shouldUseDarkColors);
  }
});

// Surface a native dialog for uncaught main-process errors instead of a silent
// crash — useful during early development / packaged smoke tests.
process.on("uncaughtException", (err) => {
  console.error("[zekra-desktop] uncaught exception:", err);
  if (app.isReady()) {
    void dialog.showMessageBox({
      type: "error",
      title: `${APP_NAME} — unexpected error`,
      message: err.message,
    });
  }
});
