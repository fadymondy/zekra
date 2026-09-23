// Apple Notes importer (macOS). Ported from Mark It Down's apple-notes
// importer: Notes.app is read through AppleScript (/usr/bin/osascript), one
// call for every note, fields/records delimited by ASCII 31/30 so bodies with
// newlines round-trip.
//
//   - locked (password-protected) notes are skipped ("locked")
//   - "Recently Deleted" is skipped ("deleted")
//   - the body HTML goes through html-to-md; Notes repeats the title as the
//     first line, which is dropped
//   - inline data: images in the body become uploads; other attachments are
//     listed by name ("Attachment not imported: …") — minimal, as MID's
//     per-attachment `save … in` round trip took seconds per file
//   - folder -> tag (except the default "Notes"), #hashtags -> tags
//
// Permission: the first run triggers macOS's Automation prompt ("Zekra wants
// to control Notes"). A denial (-1743 / "Not authorized") is reported with the
// System Settings path. The signed build needs the
// com.apple.security.automation.apple-events entitlement and an
// NSAppleEventsUsageDescription for the prompt to appear at all.
"use strict";

import { spawn } from "node:child_process";

import { nextRef } from "./attachments";
import { extractHashtags, htmlToMarkdown } from "./html-to-md";
import { ATTACHMENT_SCHEME, MAX_ATTACHMENT_BYTES, type Draft, type DraftAttachment, type Importer } from "./types";

export class AppleNotesError extends Error {
  constructor(message: string, readonly code: "permission" | "unsupported" | "failed" | "timeout") {
    super(message);
  }
}

export const APPLE_NOTES_PERMISSION_HELP =
  "Zekra is not allowed to read Apple Notes. Open System Settings › Privacy & Security › Automation, find Zekra, and turn on Notes — then try again.";

function runOsascript(script: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "darwin") {
      reject(new AppleNotesError("Apple Notes import is only available on macOS.", "unsupported"));
      return;
    }
    const child = spawn("/usr/bin/osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AppleNotesError(e.message, "failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(Object.assign(new Error("cancelled"), { code: "canceled" }));
      if (timedOut) return reject(new AppleNotesError("Apple Notes did not answer in time.", "timeout"));
      if (code !== 0) {
        if (/not authori[sz]ed|not allowed|errAEEventNotPermitted|-1743|-10004/i.test(err)) {
          return reject(new AppleNotesError(APPLE_NOTES_PERMISSION_HELP, "permission"));
        }
        return reject(new AppleNotesError(`Apple Notes: ${err.trim() || `osascript exited ${code}`}`, "failed"));
      }
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

/** Count only — the dry-run used by tests and by the preview's first number. */
export async function countAppleNotes(signal?: AbortSignal): Promise<{ notes: number; folders: number }> {
  const raw = await runOsascript(
    'tell application "Notes" to return ((count of notes) as string) & "," & ((count of folders) as string)',
    60_000,
    signal,
  );
  const [notes, folders] = raw.trim().split(",").map((n) => Number.parseInt(n, 10) || 0);
  return { notes, folders };
}

export interface RawAppleNote {
  id: string;
  title: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  attachmentNames: string[];
  bodyHtml: string;
}

const FS = "\u001f";
const RS = "\u001e";

const LIST_SCRIPT = [
  "set fieldSep to (ASCII character 31)",
  "set recordSep to (ASCII character 30)",
  "set output to {}",
  'tell application "Notes"',
  "  repeat with n in every note",
  "    set noteLocked to false",
  "    try",
  "      set noteLocked to (password protected of n) as boolean",
  "    end try",
  '    set noteFolder to ""',
  "    try",
  "      set noteFolder to (name of (container of n)) as string",
  "    end try",
  '    set attNames to ""',
  "    try",
  "      repeat with a in (every attachment of n)",
  "        try",
  "          set aName to (name of a) as string",
  '          if attNames is "" then',
  "            set attNames to aName",
  "          else",
  '            set attNames to attNames & "|" & aName',
  "          end if",
  "        end try",
  "      end repeat",
  "    end try",
  '    set noteBody to ""',
  "    if not noteLocked then",
  "      try",
  "        set noteBody to (body of n) as string",
  "      end try",
  "    end if",
  "    set end of output to ((id of n) as string) & fieldSep & ((name of n) as string) & fieldSep & noteFolder & fieldSep & ((creation date of n) as «class isot» as string) & fieldSep & ((modification date of n) as «class isot» as string) & fieldSep & (noteLocked as string) & fieldSep & attNames & fieldSep & noteBody & recordSep",
  "  end repeat",
  "end tell",
  // Concatenating a list once is far faster than growing a string per note.
  "set AppleScript's text item delimiters to \"\"",
  "return output as string",
].join("\n");

export function parseAppleNotesOutput(raw: string): RawAppleNote[] {
  const out: RawAppleNote[] = [];
  for (const rec of raw.split(RS)) {
    if (!rec.trim()) continue;
    const parts = rec.replace(/^\s+/, "").split(FS);
    if (parts.length < 8) continue;
    const [id, title, folder, created, updated, locked, atts, ...body] = parts;
    out.push({
      id: id.trim(),
      title: title.trim(),
      folder: folder.trim() || "Notes",
      createdAt: isoOrUndefined(created) ?? new Date().toISOString(),
      updatedAt: isoOrUndefined(updated) ?? new Date().toISOString(),
      locked: /true/i.test(locked),
      attachmentNames: atts.trim() ? atts.split("|").map((s) => s.trim()).filter(Boolean) : [],
      bodyHtml: body.join(FS),
    });
  }
  return out;
}

function isoOrUndefined(s: string): string | undefined {
  const d = new Date((s ?? "").trim());
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const DELETED_FOLDERS = /^(recently deleted|تم حذفها مؤخرًا|zuletzt gelöscht|suppressions récentes)$/i;

/** Pure: one raw note -> a draft (for tests). */
export function appleNoteToDraft(raw: RawAppleNote): Draft {
  const attachments: DraftAttachment[] = [];
  let md = htmlToMarkdown(raw.bodyHtml, {
    image: (src, alt) => {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(src);
      if (!m) return null; // Notes-internal URLs cannot be fetched
      const base64 = m[2].replace(/\s+/g, "");
      if ((base64.length * 3) / 4 > MAX_ATTACHMENT_BYTES) return `_Image not imported (too large)_`;
      const ext = m[1].split("/")[1].replace("jpeg", "jpg").replace(/\+.*$/, "");
      const att: DraftAttachment = { ref: nextRef(), name: `${alt || "image"}.${ext}`, mime: m[1].toLowerCase(), base64 };
      attachments.push(att);
      return `![${alt}](${ATTACHMENT_SCHEME}${att.ref})`;
    },
  });
  // Notes repeats the title as the body's first line.
  const lines = md.split("\n");
  const first = (lines[0] ?? "").replace(/^#{1,6}\s+/, "").replace(/[*_~\\]/g, "").trim();
  if (first && first === raw.title.replace(/[*_~\\]/g, "").trim()) md = lines.slice(1).join("\n").replace(/^\s*\n/, "").trim();

  const inlineImages = attachments.length;
  const others = raw.attachmentNames.slice(inlineImages);
  if (others.length) md = [md, others.map((n) => `_Attachment not imported: ${n}_`).join("\n\n")].filter(Boolean).join("\n\n");

  const tags = extractHashtags(md);
  if (raw.folder && raw.folder !== "Notes") tags.unshift(raw.folder);
  return {
    title: raw.title || "Untitled",
    body: md,
    tags: [...new Set(tags)],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    attachments,
    origin: `${raw.folder}/${raw.title}`,
  };
}

export const importAppleNotes: Importer = async (_input, ctx) => {
  const { notes: total } = await countAppleNotes(ctx.signal);
  ctx.progress(0, total, "Reading Apple Notes…");
  // Big libraries take a while: allow ~1 s per 20 notes, at least 2 minutes.
  const raw = await runOsascript(LIST_SCRIPT, Math.max(120_000, total * 50), ctx.signal);
  const notes = parseAppleNotesOutput(raw);
  const drafts: Draft[] = [];
  let done = 0;
  for (const n of notes) {
    if (ctx.signal.aborted) break;
    ctx.progress(done++, notes.length, n.title);
    if (DELETED_FOLDERS.test(n.folder)) {
      ctx.skip("deleted");
      continue;
    }
    if (n.locked) {
      ctx.skip("locked");
      continue;
    }
    const d = appleNoteToDraft(n);
    if (!d.body.trim() && !d.attachments.length) {
      ctx.skip("empty");
      continue;
    }
    drafts.push(d);
  }
  ctx.progress(notes.length, notes.length);
  return { drafts };
};
