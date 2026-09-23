// Google Keep importer: a Google Takeout export (the .zip, the extracted
// Takeout folder, its Keep/ folder, or any folder of Keep .json files).
// Ported from Mark It Down's google-keep importer. Mapping:
//   title / first line          -> title
//   textContent                 -> body
//   listContent[]               -> "- [ ]" / "- [x]" task list
//   labels[].name               -> tags
//   isPinned / isArchived       -> pinned / archived
//   isTrashed                   -> skipped ("trashed")
//   attachments[] (images)      -> uploaded images; others listed by name
//   annotations[] (web links)   -> a "Links" list
//   created/userEdited µs       -> dates
"use strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { attachmentFromPath } from "./attachments";
import { isDir, isFile, titleFromText, walkFiles } from "./fs-util";
import { ATTACHMENT_SCHEME, type Draft, type Importer } from "./types";

export interface KeepNote {
  title?: string;
  textContent?: string;
  textContentHtml?: string;
  listContent?: { text?: string; isChecked?: boolean }[];
  labels?: { name?: string }[];
  attachments?: { filePath?: string; mimetype?: string }[];
  annotations?: { url?: string; title?: string; source?: string }[];
  color?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  createdTimestampUsec?: number | string;
  userEditedTimestampUsec?: number | string;
}

export function looksLikeKeepNote(v: unknown): v is KeepNote {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const n = v as KeepNote;
  return (
    typeof n.textContent === "string" ||
    Array.isArray(n.listContent) ||
    n.createdTimestampUsec !== undefined ||
    n.userEditedTimestampUsec !== undefined
  );
}

function usecToIso(v: unknown): string | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const d = new Date(Math.round(n / 1000));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Pure: a parsed Keep note -> draft text (attachments resolved separately). */
export function keepNoteToDraft(n: KeepNote): Omit<Draft, "attachments"> {
  const parts: string[] = [];
  const text = (n.textContent ?? "").replace(/\r\n/g, "\n").trim();
  const list = Array.isArray(n.listContent) ? n.listContent : [];
  if (list.length) {
    parts.push(
      list
        .map((i) => `- [${i?.isChecked ? "x" : " "}] ${(i?.text ?? "").replace(/\r?\n/g, " ").trim()}`)
        .join("\n"),
    );
  }
  if (text) parts.unshift(text);
  const links = (n.annotations ?? []).filter((a) => a?.url);
  if (links.length) parts.push(links.map((a) => `- [${(a.title || a.url || "").replace(/[\[\]]/g, "")}](${a.url})`).join("\n"));
  const body = parts.join("\n\n");
  const title = (n.title ?? "").trim() || titleFromText(text || list.map((i) => i?.text ?? "").join("\n"), "Untitled");
  const tags = (n.labels ?? []).map((l) => (l?.name ?? "").trim()).filter(Boolean);
  return {
    title,
    body,
    tags,
    pinned: Boolean(n.isPinned),
    archived: Boolean(n.isArchived),
    createdAt: usecToIso(n.createdTimestampUsec),
    updatedAt: usecToIso(n.userEditedTimestampUsec),
  };
}

async function containsKeepJson(dir: string): Promise<boolean> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries.slice(0, 200)) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".json")) continue;
    try {
      if (looksLikeKeepNote(JSON.parse(await fs.readFile(path.join(dir, e.name), "utf8")))) return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/** The folder holding the Keep .json files, or null. */
export async function resolveKeepDir(input: string): Promise<string | null> {
  for (const c of [path.join(input, "Takeout", "Keep"), path.join(input, "Keep")]) if (await isDir(c)) return c;
  if (await containsKeepJson(input)) return input;
  // An extracted zip often wraps everything in one more folder.
  try {
    const entries = (await fs.readdir(input, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith("."));
    for (const e of entries) {
      const sub = path.join(input, e.name);
      for (const c of [path.join(sub, "Takeout", "Keep"), path.join(sub, "Keep")]) if (await isDir(c)) return c;
    }
  } catch {
    /* none */
  }
  return null;
}

export const importGoogleKeep: Importer = async (input, ctx) => {
  const keepDir = await resolveKeepDir(input);
  if (!keepDir) throw Object.assign(new Error("No Google Keep export found (looked for Takeout/Keep, Keep/, or Keep .json files)."), { code: "not-found" });
  const files = await walkFiles(keepDir, new Set([".json"]), ctx.signal);
  const drafts: Draft[] = [];
  let done = 0;
  for (const f of files) {
    if (ctx.signal.aborted) break;
    ctx.progress(done++, files.length, f.rel);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(f.abs, "utf8"));
    } catch {
      continue; // Labels.json and friends
    }
    if (!looksLikeKeepNote(parsed)) continue;
    if (parsed.isTrashed) {
      ctx.skip("trashed");
      continue;
    }
    const note = keepNoteToDraft(parsed);
    const attachments: Draft["attachments"] = [];
    const extra: string[] = [];
    for (const a of parsed.attachments ?? []) {
      if (!a?.filePath) continue;
      const base = path.basename(a.filePath);
      const candidates = [path.join(keepDir, a.filePath), path.join(keepDir, base), path.join(path.dirname(f.abs), base)];
      // Takeout sometimes records .jpeg for a file written as .jpg (or vice versa).
      const alt = base.replace(/\.jpeg$/i, ".jpg");
      if (alt !== base) candidates.push(path.join(keepDir, alt));
      let found: string | null = null;
      for (const c of candidates) if (await isFile(c)) { found = c; break; }
      const att = found ? await attachmentFromPath(found) : null;
      if (att) {
        attachments.push(att);
        extra.push(`![${att.name}](${ATTACHMENT_SCHEME}${att.ref})`);
      } else {
        extra.push(`_Attachment not imported: ${base}_`);
      }
    }
    if (extra.length) note.body = [note.body, extra.join("\n\n")].filter(Boolean).join("\n\n");
    if (!note.body.trim() && note.title === "Untitled") {
      ctx.skip("empty");
      continue;
    }
    drafts.push({ ...note, attachments, origin: f.rel });
  }
  ctx.progress(files.length, files.length);
  return { drafts };
};
