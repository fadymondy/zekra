// OS entry points into the app:
//   - the `zekra://` URL scheme (social sign-in returns to
//     zekra://auth/github?code=… / zekra://auth/google?code=…)
//   - markdown files opened from Finder / the Dock / "Open With" / argv
//
// macOS delivers both as app events (open-url / open-file) that can fire
// BEFORE "ready"; Windows/Linux deliver them in argv, to the first instance at
// launch and to `second-instance` afterwards. Everything is normalised into the
// typed events in src/shared/ipc.ts and buffered until the renderer is ready
// (renderer-events.ts).
"use strict";

import { app, dialog } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { MARKDOWN_EXTENSIONS, type DeepLinkEvent, type OpenFileEvent } from "../shared/ipc";
import { s } from "./menu-strings";
import { showSettingsWindow } from "./app-windows";
import { addRecentDocument } from "./os-integration";
import { focusMainWindow, getMainWindow, sendDeepLink, sendOpenFile } from "./renderer-events";

export const PROTOCOL = "zekra";

/** Anything larger is not a note; refuse rather than freeze the renderer. */
const MAX_MARKDOWN_BYTES = 20 * 1024 * 1024;

export function registerProtocol(): void {
  // In development Electron runs as `electron .`, so the OS must be told to
  // launch electron WITH the app path, or clicking a link opens the bare
  // Electron default app.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

export function parseDeepLink(url: string): DeepLinkEvent | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${PROTOCOL}:`) return null;
  // zekra://auth/github?code=x -> host "auth", pathname "/github"
  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return {
    url,
    host: u.hostname,
    path: u.pathname.replace(/^\/+/, ""),
    params,
  };
}

/** Links main handles itself (services.ts: zekra://app/…, zekra://notification/…). */
let interceptor: ((e: DeepLinkEvent) => boolean) | null = null;
export function setDeepLinkInterceptor(fn: ((e: DeepLinkEvent) => boolean) | null): void {
  interceptor = fn;
}

export function handleDeepLink(url: string): void {
  const event = parseDeepLink(url);
  if (!event) return;
  if (interceptor?.(event)) return;
  // zekra://settings[/<section>] opens the Settings window, not a route.
  if (event.host === "settings") {
    showSettingsWindow(event.path.split("/")[0] || undefined);
    return;
  }
  focusMainWindow();
  sendDeepLink(event);
}

function isMarkdownPath(p: string): boolean {
  const ext = path.extname(p).slice(1).toLowerCase();
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext);
}

export async function readMarkdownFile(filePath: string, origin: OpenFileEvent["origin"]): Promise<OpenFileEvent | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_MARKDOWN_BYTES) return null;
    const content = await fs.readFile(filePath, "utf8");
    return { path: filePath, name: path.basename(filePath), content, origin };
  } catch (err) {
    console.warn("[zekra] could not read", filePath, err);
    return null;
  }
}

export async function handleOpenFile(filePath: string, origin: OpenFileEvent["origin"]): Promise<void> {
  if (!isMarkdownPath(filePath)) return;
  const event = await readMarkdownFile(filePath, origin);
  if (!event) return;
  addRecentDocument(filePath); // Open Recent (macOS) / Jump List recent (Windows)
  focusMainWindow();
  sendOpenFile(event);
}

/** Pull zekra:// URLs and markdown paths out of a process argv. */
export function handleArgv(argv: string[]): void {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith(`${PROTOCOL}://`)) handleDeepLink(arg);
    else if (!arg.startsWith("-") && isMarkdownPath(arg)) void handleOpenFile(path.resolve(arg), "argv");
  }
}

/** File ▸ Open Markdown… */
export async function openMarkdownDialog(): Promise<void> {
  const win = getMainWindow();
  const opts: Electron.OpenDialogOptions = {
    title: s().openMarkdownTitle,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: s().markdownFiles, extensions: [...MARKDOWN_EXTENSIONS] }],
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled) return;
  for (const p of result.filePaths) await handleOpenFile(p, "dialog");
}

/**
 * Wire the app-level listeners. Must run synchronously at startup (before
 * "ready"): macOS fires open-file / open-url for the launch document very
 * early, and a listener added later misses it.
 */
export function installEarlyOpenHandlers(): void {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void handleOpenFile(filePath, "finder");
  });
}
