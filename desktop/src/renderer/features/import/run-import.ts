import type { ImportDraft, ImportSource } from "../../../shared/ipc";
import { ApiError, zekraApi, type Note } from "../../lib/api";
import { bridge } from "../../lib/bridge";

/*
The upload half of an import (MH-450). Main has already parsed the source
into drafts (src/main/importers); this pulls them in batches and creates one
Zekra note per draft through POST /api/notes (zekraApi.createNote, source
"desktop"):

  - images first: each attachment is uploaded (/api/notes/image) and its
    `zekra-attachment:<ref>` placeholder replaced by the returned URL; an
    image that cannot be uploaded becomes a short "not imported" line
  - one note at a time, at most ~6 per second (MIN_INTERVAL_MS), so a
    10 000-note Keep export does not hammer the API
  - 429 / 5xx / network errors are retried with backoff (1 s, 2 s, 4 s, 8 s);
    other 4xx fail that note only; 401 stops the whole import (session gone)
  - empty drafts (no title and no body) are skipped
  - every note gets the tags "imported" and the source ("apple-notes" …)
  - archived drafts (Keep) are archived after creation
*/

export type ImportFailure = { title: string; origin?: string; error: string };

export type ImportTally = {
  imported: number;
  skipped: number;
  failed: ImportFailure[];
  stopped: boolean;
  /** The first note created — "Open brain" can land on it. */
  firstNoteId?: string;
};

export type ImportProgress = { done: number; total: number; current?: string };

const MIN_INTERVAL_MS = 160;
const BACKOFF_MS = [1000, 2000, 4000, 8000];
const MAX_TITLE = 200;
const MAX_TAGS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retriable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // thrown by the bridge: network
  return e.status === 0 || e.status === 429 || e.status >= 500;
}

async function withRetry<T>(fn: () => Promise<T>, stopped: () => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e;
      if (!retriable(e) || attempt >= BACKOFF_MS.length || stopped()) throw e;
      await sleep(BACKOFF_MS[attempt]);
    }
  }
}

export function importTags(draft: Pick<ImportDraft, "tags">, source: ImportSource): string[] {
  const out: string[] = [];
  for (const t of ["imported", source, ...draft.tags]) {
    const clean = String(t ?? "").trim().replace(/^#/, "").slice(0, 64);
    if (clean && !out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out.slice(0, MAX_TAGS);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function uploadImages(token: string, namespace: string, draft: ImportDraft, stopped: () => boolean): Promise<string> {
  let body = draft.body;
  for (const a of draft.attachments) {
    const placeholder = `zekra-attachment:${a.ref}`;
    if (!body.includes(placeholder)) continue;
    let url: string | null = null;
    if (a.bytes && a.bytes.byteLength) {
      try {
        const blob = new Blob([a.bytes as BlobPart], { type: a.mime });
        const file = new File([blob], a.name, { type: a.mime });
        url = (await withRetry(() => zekraApi.uploadImage(token, file, namespace), stopped)).url;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e;
        url = null;
      }
    }
    if (url) body = body.split(placeholder).join(url);
    else body = body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escapeRe(placeholder)}\\)`, "g"), `_Image not imported: ${a.name.replace(/[_*]/g, "")}_`);
  }
  return body;
}

/**
 * Pull every draft of the scanned import `id` and create the notes in
 * `namespace`. `shouldStop` is polled between notes (the Stop button).
 * Always releases the job in main, even on failure.
 */
export async function runImport(opts: {
  id: string;
  token: string;
  namespace: string;
  source: ImportSource;
  total: number;
  shouldStop: () => boolean;
  onProgress: (p: ImportProgress) => void;
}): Promise<ImportTally> {
  const { id, token, namespace, source, total, shouldStop } = opts;
  const b = bridge();
  const tally: ImportTally = { imported: 0, skipped: 0, failed: [], stopped: false };
  let done = 0;
  let last = 0;
  try {
    for (;;) {
      if (shouldStop()) {
        tally.stopped = true;
        break;
      }
      const batch = await b.importNext!(id, 10);
      for (const draft of batch.drafts) {
        if (shouldStop()) {
          tally.stopped = true;
          break;
        }
        const title = (draft.title ?? "").trim().slice(0, MAX_TITLE);
        opts.onProgress({ done, total, current: title });
        if (!title && !draft.body.trim()) {
          tally.skipped++;
          done++;
          continue;
        }
        const wait = last + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        try {
          const body = await uploadImages(token, namespace, draft, shouldStop);
          const note: Note = await withRetry(
            () =>
              zekraApi.createNote(token, namespace, {
                title: title || "Untitled",
                body,
                tags: importTags(draft, source),
                pinned: Boolean(draft.pinned),
              }),
            shouldStop,
          );
          if (draft.archived) {
            await withRetry(() => zekraApi.updateNote(token, note, { archived: true }), shouldStop).catch(() => undefined);
          }
          tally.imported++;
          tally.firstNoteId ??= note.id;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) throw e;
          tally.failed.push({ title: title || "Untitled", origin: draft.origin, error: e instanceof Error ? e.message : String(e) });
        }
        done++;
        opts.onProgress({ done, total });
      }
      if (tally.stopped || batch.done) break;
    }
  } finally {
    await b.importCancel?.(id).catch(() => undefined);
  }
  return tally;
}
