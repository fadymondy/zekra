// Settings ▸ Connect ▸ "Install for Claude Code / Cursor" (MH-450), after Mark
// It Down's tray installer (apps/electron/main.ts installMCPFor) — but for
// Zekra's REMOTE MCP server, so there is no local script to point at:
//
//   ~/.claude.json      mcpServers.zekra = { type: "http", url }
//   ~/.cursor/mcp.json  mcpServers.zekra = { url }
//
// Unlike Mark It Down this never "starts fresh" over a file it cannot parse:
// ~/.claude.json carries all of Claude Code's state, so an unreadable file is
// an error, not an empty object. Every write is confirmed with a native dialog
// (the renderer cannot skip it), preceded by a timestamped backup copy, and
// done atomically (temp file + rename).
"use strict";

import { BrowserWindow, dialog } from "electron";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { McpInstallResult, McpInstallStatus, McpTarget } from "../shared/ipc";
import { getMenuLocale } from "./menu-strings";

const ENTRY = "zekra";

const TOOL_NAME: Record<McpTarget, string> = { claude: "Claude Code", cursor: "Cursor" };

// Kept here rather than in menu-strings.ts: only this dialog uses them.
const STRINGS = {
  en: {
    confirm: "Install Zekra's MCP server for {tool}?",
    backup: "The current file is copied to a .zekra-backup-… file next to it first. Restart {tool} afterwards.",
    newFile: "The file does not exist yet and will be created. Restart {tool} afterwards.",
    install: "Install",
    cancel: "Cancel",
  },
  ar: {
    confirm: "تثبيت خادم MCP الخاص بذكرة في {tool}؟",
    backup: "يُنسخ الملف الحالي أولًا إلى ملف ‎.zekra-backup-…‎ بجانبه. أعد تشغيل {tool} بعد ذلك.",
    newFile: "الملف غير موجود بعد وسيُنشأ. أعد تشغيل {tool} بعد ذلك.",
    install: "تثبيت",
    cancel: "إلغاء",
  },
} as const;

function str(key: keyof (typeof STRINGS)["en"], tool: string): string {
  return STRINGS[getMenuLocale() === "ar" ? "ar" : "en"][key].replace("{tool}", tool);
}

function configPath(target: McpTarget): string {
  const home = os.homedir();
  return target === "claude" ? path.join(home, ".claude.json") : path.join(home, ".cursor", "mcp.json");
}

type Config = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

/** The file's JSON; null when it does not exist. Throws when it exists but is not a JSON object. */
async function readConfig(file: string): Promise<Config | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
  return parsed as Config;
}

function entryFor(target: McpTarget, url: string): Record<string, string> {
  return target === "claude" ? { type: "http", url } : { url };
}

export async function mcpStatus(): Promise<McpInstallStatus> {
  const has = async (target: McpTarget) => {
    try {
      const cfg = await readConfig(configPath(target));
      const servers = cfg?.mcpServers;
      return Boolean(servers && typeof servers === "object" && ENTRY in servers);
    } catch {
      return false;
    }
  };
  const [claude, cursor] = await Promise.all([has("claude"), has("cursor")]);
  return { claude, cursor };
}

export async function installMcp(win: BrowserWindow | null, target: McpTarget, url: string): Promise<McpInstallResult> {
  if (target !== "claude" && target !== "cursor") return { status: "error", message: "unknown tool" };
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return { status: "error", message: "invalid MCP URL" };
  }
  if (parsed.protocol !== "https:") return { status: "error", message: "the MCP URL must be https" };
  const cleanUrl = parsed.toString().replace(/\/$/, "");

  const file = configPath(target);
  const tool = TOOL_NAME[target];

  let cfg: Config | null;
  try {
    cfg = await readConfig(file);
  } catch (e) {
    return { status: "error", path: file, message: `${file} could not be read (${(e as Error).message}); nothing was changed` };
  }

  const entry = entryFor(target, cleanUrl);
  const opts: Electron.MessageBoxOptions = {
    type: "question",
    message: str("confirm", tool),
    detail: `${file}\n\n"mcpServers": { "${ENTRY}": ${JSON.stringify(entry)} }\n\n${str(cfg ? "backup" : "newFile", tool)}`,
    buttons: [str("install", tool), str("cancel", tool)],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (response !== 0) return { status: "cancelled" };

  // Re-read: the dialog may have been open for a while, and Claude Code
  // rewrites ~/.claude.json often — merge into what is there NOW.
  try {
    cfg = await readConfig(file);
  } catch (e) {
    return { status: "error", path: file, message: `${file} could not be read (${(e as Error).message}); nothing was changed` };
  }

  try {
    let backup: string | undefined;
    let mode = 0o600;
    if (cfg) {
      mode = (await fs.stat(file)).mode & 0o777;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backup = `${file}.zekra-backup-${stamp}`;
      await fs.copyFile(file, backup);
    }
    const next: Config = cfg ?? {};
    const servers = next.mcpServers && typeof next.mcpServers === "object" && !Array.isArray(next.mcpServers) ? next.mcpServers : {};
    next.mcpServers = { ...servers, [ENTRY]: entry };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.zekra-tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode });
    await fs.rename(tmp, file);
    return { status: "installed", path: file, backup };
  } catch (e) {
    return { status: "error", path: file, message: (e as Error).message };
  }
}
