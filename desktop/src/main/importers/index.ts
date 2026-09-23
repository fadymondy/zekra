// Import jobs (MH-450 — Mark It Down's importers, in Zekra).
//
// The renderer is sandboxed and cannot read files, so all parsing happens here
// and the renderer only uploads. One import is a JOB:
//
//   scan(id, source)   pick the source (native dialog; none for Apple Notes),
//                      extract a zip to a temp dir, parse EVERYTHING into
//                      drafts, report counts/sample. Streams progress events
//                      (evImportProgress) and can be cancelled mid-way.
//   next(id, max)      hand the renderer the next batch of drafts, with the
//                      attachment bytes for that batch only (pull-based, so a
//                      slow upload never buffers the whole import in IPC).
//   cancel(id)         abort a running scan and/or release the job (temp dir
//                      removed). The renderer also calls it when it finishes.
//
// Jobs left behind (renderer reloaded mid-import) expire after two hours and
// temp dirs are removed on quit.
"use strict";

import { app, BrowserWindow, dialog } from "electron";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
  ImportAttachment,
  ImportBatch,
  ImportDraft,
  ImportErrorCode,
  ImportProgressEvent,
  ImportScanRequest,
  ImportScanResult,
  ImportSource,
} from "../../shared/ipc";
import { IPC } from "../../shared/ipc";
import { AppleNotesError, importAppleNotes } from "./apple-notes";
import { extractZip, isDir, removeDir } from "./fs-util";
import { importGoogleKeep } from "./google-keep";
import { importMarkdownFolder } from "./markdown-folder";
import { importNotion } from "./notion";
import type { Draft, Importer } from "./types";

const IMPORTERS: Record<ImportSource, Importer> = {
  "apple-notes": importAppleNotes,
  "google-keep": importGoogleKeep,
  notion: importNotion,
  "markdown-folder": importMarkdownFolder,
};

const PICK_TITLE: Record<ImportSource, string> = {
  "apple-notes": "Apple Notes",
  "google-keep": "Choose your Google Takeout export (.zip or folder)",
  notion: "Choose your Notion export (.zip or folder)",
  "markdown-folder": "Choose a folder of Markdown notes",
};

const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const BATCH_BYTES = 24 * 1024 * 1024;

interface Job {
  id: string;
  abort: AbortController;
  drafts: Draft[];
  cursor: number;
  tmpDir?: string;
  created: number;
}

const jobs = new Map<string, Job>();

function send(win: BrowserWindow | null, e: ImportProgressEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.evImportProgress, e);
}

async function release(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  job.abort.abort();
  jobs.delete(id);
  await removeDir(job.tmpDir);
}

function purgeExpired(): void {
  const now = Date.now();
  for (const j of jobs.values()) if (now - j.created > JOB_TTL_MS) void release(j.id);
}

async function pickSource(win: BrowserWindow | null, source: ImportSource): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: PICK_TITLE[source],
    message: PICK_TITLE[source],
    buttonLabel: "Choose",
    // macOS lets one panel pick a folder OR a file; filters apply to files.
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

function toCode(err: unknown): ImportErrorCode {
  if (err instanceof AppleNotesError) return err.code;
  const code = (err as { code?: string })?.code;
  if (code === "not-found") return "not-found";
  return "failed";
}

export async function scanImport(win: BrowserWindow | null, req: ImportScanRequest): Promise<ImportScanResult> {
  purgeExpired();
  const id = String(req.id);
  const source = req.source;
  const empty = (status: ImportScanResult["status"], extra: Partial<ImportScanResult> = {}): ImportScanResult => ({
    id,
    status,
    total: 0,
    skipped: {},
    sample: [],
    images: 0,
    warnings: [],
    ...extra,
  });
  if (!IMPORTERS[source]) return empty("error", { errorCode: "unsupported", error: `Unknown source ${source}` });
  if (source === "apple-notes" && process.platform !== "darwin") {
    return empty("error", { errorCode: "unsupported", error: "Apple Notes import is only available on macOS." });
  }

  await release(id);
  const job: Job = { id, abort: new AbortController(), drafts: [], cursor: 0, created: Date.now() };
  jobs.set(id, job);
  const { signal } = job.abort;

  let input = "";
  let label = "Apple Notes";
  if (source !== "apple-notes") {
    const picked = await pickSource(win, source);
    if (!picked) {
      jobs.delete(id);
      return empty("canceled");
    }
    input = picked;
    label = path.basename(picked);
    if (!(await isDir(picked))) {
      if (!picked.toLowerCase().endsWith(".zip")) {
        jobs.delete(id);
        return empty("error", { errorCode: "not-found", error: "Choose a folder or a .zip archive.", sourceLabel: label });
      }
      send(win, { id, done: 0, message: `Extracting ${label}…` });
      try {
        job.tmpDir = await extractZip(picked, signal);
        input = job.tmpDir;
      } catch (err) {
        await release(id);
        if (signal.aborted) return empty("canceled");
        return empty("error", { errorCode: "failed", error: `Could not extract ${label}: ${(err as Error).message}`, sourceLabel: label });
      }
    }
  }

  const skipped: Record<string, number> = {};
  const warnings: string[] = [];
  let lastSent = 0;
  try {
    const { drafts } = await IMPORTERS[source](input, {
      signal,
      progress: (done, total, message) => {
        const now = Date.now();
        if (now - lastSent < 80 && done !== total) return; // ~12 events/s is plenty
        lastSent = now;
        send(win, { id, done, total, message });
      },
      warn: (m) => {
        if (warnings.length < 50) warnings.push(m);
      },
      skip: (reason) => {
        skipped[reason] = (skipped[reason] ?? 0) + 1;
      },
    });
    if (signal.aborted) {
      await release(id);
      return empty("canceled");
    }
    job.drafts = drafts;
    if (!drafts.length) {
      await release(id);
      return empty("error", { errorCode: "empty", error: "Nothing to import was found there.", sourceLabel: label, skipped, warnings });
    }
    return {
      id,
      status: "ok",
      sourceLabel: label,
      total: drafts.length,
      skipped,
      sample: drafts.slice(0, 8).map((d) => d.title),
      images: drafts.reduce((n, d) => n + d.attachments.length, 0),
      warnings,
    };
  } catch (err) {
    await release(id);
    if (signal.aborted || (err as { code?: string })?.code === "canceled") return empty("canceled");
    return empty("error", { errorCode: toCode(err), error: (err as Error).message, sourceLabel: label, skipped, warnings });
  }
}

async function loadAttachment(a: Draft["attachments"][number]): Promise<ImportAttachment> {
  let bytes: Uint8Array | null = null;
  try {
    if (a.base64) bytes = new Uint8Array(Buffer.from(a.base64, "base64"));
    else if (a.path) bytes = new Uint8Array(await fs.readFile(a.path));
  } catch {
    bytes = null;
  }
  return { ref: a.ref, name: a.name, mime: a.mime, bytes };
}

export async function nextImportBatch(id: string, max: number): Promise<ImportBatch> {
  const job = jobs.get(String(id));
  if (!job) return { drafts: [], done: true, remaining: 0 };
  const out: ImportDraft[] = [];
  let bytes = 0;
  const limit = Math.max(1, Math.min(50, Math.floor(Number(max) || 10)));
  while (job.cursor < job.drafts.length && out.length < limit && (bytes < BATCH_BYTES || out.length === 0)) {
    const d = job.drafts[job.cursor++];
    const attachments = await Promise.all(d.attachments.map(loadAttachment));
    bytes += attachments.reduce((n, a) => n + (a.bytes?.byteLength ?? 0), 0) + d.body.length;
    out.push({
      title: d.title,
      body: d.body,
      tags: d.tags,
      pinned: d.pinned,
      archived: d.archived,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      origin: d.origin,
      attachments,
    });
  }
  const remaining = job.drafts.length - job.cursor;
  return { drafts: out, done: remaining === 0, remaining };
}

export async function cancelImport(id: string): Promise<void> {
  await release(String(id));
}

let quitHooked = false;
export function hookImportCleanup(): void {
  if (quitHooked) return;
  quitHooked = true;
  app.on("will-quit", () => {
    for (const j of jobs.values()) {
      j.abort.abort();
      // Synchronous best effort: the process is going away.
      if (j.tmpDir) void fs.rm(j.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    jobs.clear();
  });
}
