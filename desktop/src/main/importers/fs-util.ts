// Filesystem helpers shared by the folder/zip importers: a cancellable
// recursive walk and zip extraction.
//
// Zips are extracted with the OS tool (ditto on macOS, unzip elsewhere) into a
// temp dir rather than parsed in JS: Takeout and Notion exports are routinely
// several GB and ZIP64, and the desktop ships no zip dependency. Notion's
// "Export all" nests one zip per part inside the outer zip, so a folder that
// contains only zips is expanded one level further.
"use strict";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SKIP = new Set([".git", ".obsidian", ".trash", ".Trash", "node_modules", "__MACOSX", ".DS_Store"]);

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function skipName(name: string): boolean {
  return !name || name.startsWith(".") || SKIP.has(name);
}

export interface WalkedFile {
  abs: string;
  /** POSIX path relative to the walk root. */
  rel: string;
}

/** Every file under `root` whose extension is in `exts` (lower-case, with dot). */
export async function walkFiles(root: string, exts: Set<string>, signal?: AbortSignal): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const stack = [root];
  while (stack.length) {
    if (signal?.aborted) break;
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skipName(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) out.push({ abs, rel: toPosix(path.relative(root, abs)) });
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve();
    });
    signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  });
}

async function extractOne(zip: string, dest: string, signal?: AbortSignal): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  if (process.platform === "darwin") await run("/usr/bin/ditto", ["-x", "-k", zip, dest], signal);
  else await run("unzip", ["-q", "-o", zip, "-d", dest], signal);
}

/**
 * Extract `zip` into a fresh temp dir and return it. Zips found at the top of
 * the result (Notion's per-part archives) are extracted in place too. The
 * caller owns the dir and must remove it (see `removeDir`).
 */
export async function extractZip(zip: string, signal?: AbortSignal): Promise<string> {
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), "zekra-import-"));
  try {
    await extractOne(zip, dest, signal);
    const top = await fs.readdir(dest, { withFileTypes: true });
    const inner = top.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".zip"));
    for (const z of inner) {
      if (signal?.aborted) break;
      const sub = path.join(dest, z.name.replace(/\.zip$/i, ""));
      await extractOne(path.join(dest, z.name), sub, signal);
      await fs.rm(path.join(dest, z.name), { force: true });
    }
    return dest;
  } catch (err) {
    await removeDir(dest);
    throw err;
  }
}

export async function removeDir(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Title for a note whose source has none: the first meaningful line. */
export function titleFromText(text: string, fallback: string, max = 80): string {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw
      .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (line) return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
  }
  return fallback;
}
