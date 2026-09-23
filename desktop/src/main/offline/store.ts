// On-disk offline cache. Plain JSON documents, written atomically — no native
// module, so nothing to electron-rebuild, nothing that breaks the universal
// (x64+arm64) build, and no `cs.disable-library-validation` entitlement under
// the hardened runtime (which better-sqlite3 would need; Mark It Down did).
// The data is small (a brain of a few thousand notes is a few MB of JSON),
// is read once per brain into memory and served from there, so a database's
// query engine would buy nothing here.
//
// Layout (under app.getPath("userData")):
//
//   offline-cache/v1/<scope>/            scope = sha256(apiBaseUrl \n userId)[:16],
//                                        so accounts / servers never mix
//     scope.json                         { apiBaseUrl, userId, email } (for humans)
//     brains.json                        { brains, fetchedAt }
//     queue.json                         { ops, selfWrites, idMap, conflicts }  — the outbox
//     ns/<slug>-<hash>.json              one brain: { namespace, since, syncedAt,
//                                        complete, notes{id:Note}, shadows{id:Note} }
//     versions/<slug>-<hash>.json        { <noteId>: { versions (no bodies), fetchedAt } }
//
// Files are 0600 in 0700 directories. Writes go to a temp file that is
// fsync'd and renamed over the target, so a crash leaves the old or the new
// document, never half of one. Brain documents are written debounced (bursty
// pulls); the queue is written immediately (it holds the user's unsynced work).
"use strict";

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { OfflineBrains, OfflineNote, OfflineVersions, SyncConflict } from "../../shared/services";
import type { NsCache, QueueOp, SelfWrites } from "./sync-core";

export const CACHE_VERSION = "v1";

export interface NsDoc extends NsCache {
  namespace: string;
  /** Next `since` for the incremental pull (the last serverTime). */
  since: string | null;
  syncedAt: string | null;
  complete: boolean;
}

export interface QueueDoc {
  ops: QueueOp[];
  selfWrites: SelfWrites;
  /** local:… -> server id, for creates pushed while an editor still holds the local id. */
  idMap: Record<string, string>;
  conflicts: SyncConflict[];
}

export interface ScopeInfo {
  apiBaseUrl: string;
  userId: string;
  email?: string;
}

export function scopeKey(s: ScopeInfo): string {
  return createHash("sha256").update(`${s.apiBaseUrl.replace(/\/+$/, "")}\n${s.userId}`).digest("hex").slice(0, 16);
}

/** A file name for a namespace: readable slug + hash (namespaces are free text). */
export function nsFileName(ns: string): string {
  const slug = ns.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "brain";
  const hash = createHash("sha256").update(ns).digest("hex").slice(0, 10);
  return `${slug}-${hash}.json`;
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const fh = await fsp.open(tmp, "w", 0o600);
  try {
    await fh.writeFile(JSON.stringify(data), "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[zekra] offline cache: unreadable", file, (err as Error).message);
    return null;
  }
}

const emptyQueue = (): QueueDoc => ({ ops: [], selfWrites: {}, idMap: {}, conflicts: [] });

export class OfflineStore {
  private dir: string | null = null;
  private nsDocs = new Map<string, NsDoc>();
  private nsLoads = new Map<string, Promise<NsDoc>>();
  private dirtyNs = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private queueDoc: QueueDoc | null = null;
  private brainsDoc: OfflineBrains | null = null;
  private versionsDocs = new Map<string, Record<string, OfflineVersions>>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly flushDelayMs = 800,
  ) {}

  /** Switch to an account's cache (null = signed out: nothing is served). */
  async setScope(scope: ScopeInfo | null): Promise<void> {
    const next = scope ? path.join(this.root, CACHE_VERSION, scopeKey(scope)) : null;
    if (next === this.dir) return;
    await this.flush();
    this.dir = next;
    this.nsDocs.clear();
    this.nsLoads.clear();
    this.versionsDocs.clear();
    this.queueDoc = null;
    this.brainsDoc = null;
    if (next && scope) {
      await fsp.mkdir(next, { recursive: true, mode: 0o700 });
      await writeJsonAtomic(path.join(next, "scope.json"), { apiBaseUrl: scope.apiBaseUrl, userId: scope.userId, email: scope.email });
    }
  }

  get scoped(): boolean {
    return this.dir !== null;
  }

  private file(...parts: string[]): string {
    if (!this.dir) throw new Error("offline cache has no scope");
    return path.join(this.dir, ...parts);
  }

  /* ---------------------------------------------------------- brains */

  async brains(): Promise<OfflineBrains> {
    if (!this.dir) return { brains: [], fetchedAt: null };
    if (!this.brainsDoc) this.brainsDoc = (await readJson<OfflineBrains>(this.file("brains.json"))) ?? { brains: [], fetchedAt: null };
    return this.brainsDoc;
  }

  async setBrains(doc: OfflineBrains): Promise<void> {
    if (!this.dir) return;
    this.brainsDoc = doc;
    await this.serial(() => writeJsonAtomic(this.file("brains.json"), doc));
  }

  /* ----------------------------------------------------------- notes */

  /** The brain's document, loaded once and kept in memory. */
  ns(namespace: string): Promise<NsDoc> {
    const have = this.nsDocs.get(namespace);
    if (have) return Promise.resolve(have);
    const loading = this.nsLoads.get(namespace);
    if (loading) return loading;
    const dir = this.dir;
    const job = (async () => {
      const empty: NsDoc = { namespace, since: null, syncedAt: null, complete: false, notes: {}, shadows: {} };
      if (!dir) return empty;
      const doc = (await readJson<NsDoc>(path.join(dir, "ns", nsFileName(namespace)))) ?? empty;
      doc.notes ??= {};
      doc.shadows ??= {};
      if (this.dir === dir) this.nsDocs.set(namespace, doc);
      return doc;
    })();
    this.nsLoads.set(namespace, job);
    void job.finally(() => this.nsLoads.delete(namespace));
    return job;
  }

  /** Mark a brain document changed; written after a short debounce. */
  touch(namespace: string): void {
    if (!this.dir) return;
    this.dirtyNs.add(namespace);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dir) {
      this.dirtyNs.clear();
      return this.writeChain;
    }
    const names = [...this.dirtyNs];
    this.dirtyNs.clear();
    for (const ns of names) {
      const doc = this.nsDocs.get(ns);
      if (!doc) continue;
      const file = this.file("ns", nsFileName(ns));
      await this.serial(() => writeJsonAtomic(file, doc));
    }
    return this.writeChain;
  }

  async getNote(namespace: string, id: string): Promise<OfflineNote | null> {
    const doc = await this.ns(namespace);
    return doc.notes[id] ?? null;
  }

  /* ----------------------------------------------------------- queue */

  async queue(): Promise<QueueDoc> {
    if (!this.dir) return (this.queueDoc ??= emptyQueue());
    if (!this.queueDoc) {
      const q = (await readJson<QueueDoc>(this.file("queue.json"))) ?? emptyQueue();
      q.ops ??= [];
      q.selfWrites ??= {};
      q.idMap ??= {};
      q.conflicts ??= [];
      // A crash mid-push leaves an op marked in flight; it is simply retried
      // (the server's version check makes a repeated update safe).
      for (const op of q.ops) op.inflight = false;
      this.queueDoc = q;
    }
    return this.queueDoc;
  }

  async saveQueue(): Promise<void> {
    if (!this.dir || !this.queueDoc) return;
    const doc = this.queueDoc;
    await this.serial(() => writeJsonAtomic(this.file("queue.json"), doc));
  }

  /* -------------------------------------------------------- versions */

  async versions(namespace: string, id: string): Promise<OfflineVersions> {
    const doc = await this.versionsDoc(namespace);
    return doc[id] ?? { id, versions: [], fetchedAt: null };
  }

  async setVersions(namespace: string, v: OfflineVersions): Promise<void> {
    if (!this.dir) return;
    const doc = await this.versionsDoc(namespace);
    doc[v.id] = v;
    const file = this.file("versions", nsFileName(namespace));
    await this.serial(() => writeJsonAtomic(file, doc));
  }

  private async versionsDoc(namespace: string): Promise<Record<string, OfflineVersions>> {
    let doc = this.versionsDocs.get(namespace);
    if (!doc) {
      doc = this.dir ? ((await readJson<Record<string, OfflineVersions>>(this.file("versions", nsFileName(namespace)))) ?? {}) : {};
      this.versionsDocs.set(namespace, doc);
    }
    return doc;
  }

  /* ----------------------------------------------------------- admin */

  /** Remove the cached brains/notes/versions of this scope; the outbox is
   *  kept unless `includeQueue` (it is the user's unsynced work). */
  async clear(includeQueue = false): Promise<void> {
    if (!this.dir) return;
    await this.flush();
    this.nsDocs.clear();
    this.versionsDocs.clear();
    this.brainsDoc = null;
    const dir = this.dir;
    await this.serial(async () => {
      await fsp.rm(path.join(dir, "ns"), { recursive: true, force: true });
      await fsp.rm(path.join(dir, "versions"), { recursive: true, force: true });
      await fsp.rm(path.join(dir, "brains.json"), { force: true });
      if (includeQueue) await fsp.rm(path.join(dir, "queue.json"), { force: true });
    });
    if (includeQueue) this.queueDoc = emptyQueue();
  }

  /** Approximate bytes on disk for this scope. */
  async sizeBytes(): Promise<number> {
    if (!this.dir) return 0;
    let total = 0;
    const walk = async (d: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
      }
    };
    await walk(this.dir);
    return total;
  }

  /** Writes run one at a time (a slow disk must not reorder them). */
  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch((err) => console.warn("[zekra] offline cache write failed", err));
    return next;
  }
}
