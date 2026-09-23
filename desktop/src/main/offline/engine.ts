// The background sync engine: pulls every brain incrementally into the
// offline store, pushes the outbox, and keeps a status the UI can show.
//
// Electron-free by construction — the network, auth, clock and events are
// injected (services.ts wires them to api-proxy / settings-store / IPC), so
// the whole engine runs under plain node in test/sync-engine.test.cjs against
// a fake server.
//
// When it runs:  launch; app focus (if the last sync is > 60 s old); every
// `syncIntervalMinutes` (x3 on battery, paused on suspend / Low Power Mode /
// thermal pressure); ~1 s after a local edit; on demand (Sync Now). Transport
// failures flip it offline and it probes again every 30 s (plus net.isOnline).
"use strict";

import type {
  OfflineBrain,
  OfflineBrains,
  OfflineEdit,
  OfflineEnqueueResult,
  OfflineNote,
  OfflineNotesResult,
  OfflineQuery,
  OfflineVersionMeta,
  OfflineVersions,
  SyncChangeEvent,
  SyncConflict,
  SyncPauseReason,
  SyncStatus,
} from "../../shared/services";
import type { OfflineStore, NsDoc, QueueDoc } from "./store";
import {
  backoffDelay,
  classifyStatus,
  cleanPatch,
  coalesce,
  conflictCopyTitle,
  isLocalId,
  LOCAL_ID_PREFIX,
  localView,
  mergeIncoming,
  nextReady,
  normaliseRemote,
  pickFields,
  queryNotes,
  recordSelfWrite,
  resolveBaseVersion,
  resolveConflict,
  type QueueOp,
} from "./sync-core";

export interface HttpResponse {
  status: number;
  body: string;
}

export interface EngineAuth {
  apiBaseUrl: string;
  token: string | null;
  userId: string | null;
  email?: string;
}

export interface EngineDeps {
  store: OfflineStore;
  /** One API call. Rejects on a transport failure (offline, DNS, TLS). */
  http(method: string, path: string, json?: unknown, headers?: Record<string, string>): Promise<HttpResponse>;
  auth(): EngineAuth;
  enabled(): boolean;
  intervalMinutes(): number;
  /** The OS's view (Electron net.isOnline()). */
  isOnline(): boolean;
  onStatus(s: SyncStatus): void;
  onChange(e: SyncChangeEvent): void;
  now?(): number;
  rand?(): number;
  newId?(): string;
  /** Label of the "(conflicted copy …)" suffix, localised by the caller. */
  conflictLabel?(): string;
  log?(...args: unknown[]): void;
}

class TransportError extends Error {}
class AuthError extends Error {}

const PAGE_LIMIT = 200;
const MAX_PAGES = 500;
const PROBE_MS = 30_000;
const PUSH_DEBOUNCE_MS = 1_000;
const FOCUS_STALE_MS = 60_000;
const MAX_CONFLICTS = 50;
const EPOCH = "1970-01-01T00:00:00Z";

type SyncReason = "launch" | "timer" | "focus" | "edit" | "user" | "online" | "resume" | "auth";

export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private online = true;
  private failures = 0;
  private lastSyncedAt: string | null = null;
  private lastError: string | undefined;
  private authFailed = false;
  private paused: SyncPauseReason | null = null;
  private powerFactor = 1;
  private nextSyncAt: number | null = null;
  private scopeKey = "";
  private scoping: Promise<void> = Promise.resolve();
  private stopped = true;
  private readonly now: () => number;

  constructor(private readonly d: EngineDeps) {
    this.now = d.now ?? Date.now;
  }

  /* --------------------------------------------------------- lifecycle */

  async start(): Promise<void> {
    this.stopped = false;
    await this.ensureScope();
    this.emitStatus();
    this.kick("launch", 1_500);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    await this.running?.catch(() => undefined);
    await this.d.store.flush();
  }

  /** Settings changed (token, user, API origin, enabled, interval). */
  async onSettingsChanged(): Promise<void> {
    const changed = await this.ensureScope();
    if (changed) this.authFailed = false;
    this.emitStatus();
    this.kick(changed ? "auth" : "timer", changed ? 200 : 0);
  }

  setPaused(reason: SyncPauseReason | null): void {
    if (this.paused === reason) return;
    this.paused = reason;
    this.emitStatus();
    if (!reason) this.kick("resume", 3_000);
    else this.schedule();
  }

  get pausedReason(): SyncPauseReason | null {
    return this.paused;
  }

  /** 1 on AC power; 3 on battery (a longer period between background pulls). */
  setPowerFactor(f: number): void {
    this.powerFactor = Math.max(1, f);
    this.schedule();
  }

  onFocus(): void {
    const last = this.lastSyncedAt ? Date.parse(this.lastSyncedAt) : 0;
    if (this.now() - last > FOCUS_STALE_MS) this.kick("focus", 0);
  }

  /** The OS says the network came back. */
  onNetworkMaybeBack(): void {
    if (!this.online && this.d.isOnline()) void this.resetBackoff().then(() => this.kick("online", 500));
  }

  /** Sync Now: skip every backoff and run a full sync. */
  async syncNow(): Promise<SyncStatus> {
    this.failures = 0;
    this.authFailed = false;
    await this.resetBackoff();
    await this.run("user");
    return this.status();
  }

  /** Queued pushes retry immediately (the network is back / the user asked). */
  private async resetBackoff(): Promise<void> {
    if (!this.d.store.scoped) return;
    const q = await this.d.store.queue();
    for (const op of q.ops) op.nextAttemptAt = 0;
  }

  /* ------------------------------------------------------------ reads */

  async notes(namespace: string, query: OfflineQuery = {}): Promise<OfflineNotesResult> {
    await this.ensureScope();
    const doc = await this.d.store.ns(namespace);
    const r = queryNotes(Object.values(doc.notes), query);
    return { namespace, ...r, syncedAt: doc.syncedAt, complete: doc.complete };
  }

  async note(namespace: string, id: string): Promise<OfflineNote | null> {
    await this.ensureScope();
    const q = await this.d.store.queue();
    const real = q.idMap[id] ?? id;
    return (await this.d.store.ns(namespace)).notes[real] ?? null;
  }

  async brains(): Promise<OfflineBrains> {
    await this.ensureScope();
    return this.d.store.brains();
  }

  /** The brains list: fetched when online (and signed in), else the cached one. */
  async refreshBrains(): Promise<OfflineBrains> {
    await this.ensureScope();
    if (this.canNetwork()) {
      try {
        await this.pullBrains();
        this.online = true;
      } catch (err) {
        if (err instanceof TransportError) this.online = false;
      }
    }
    return this.d.store.brains();
  }

  get isOnline(): boolean {
    return this.online && this.d.isOnline();
  }

  async versions(namespace: string, id: string): Promise<OfflineVersions> {
    await this.ensureScope();
    const cached = await this.d.store.versions(namespace, id);
    if (isLocalId(id) || !this.canNetwork()) return cached;
    const refresh = this.fetchVersions(namespace, id).catch(() => cached);
    // Cached: answer now, refresh behind. Never fetched: wait for the network.
    return cached.fetchedAt ? cached : refresh;
  }

  /** Write-through of a note the renderer just got from the API. */
  async put(raw: unknown): Promise<void> {
    await this.ensureScope();
    const n = normaliseRemote(raw);
    if (!n || !this.d.store.scoped) return;
    const doc = await this.d.store.ns(n.namespace);
    const q = await this.d.store.queue();
    const dirty = this.dirtyIds(q);
    const res = mergeIncoming(doc, [n], dirty);
    if (res.upserted.length || res.removed.length) {
      this.d.store.touch(n.namespace);
      this.d.onChange({ namespace: n.namespace, upserted: res.upserted, removed: res.removed, reason: "pull" });
    } else if (dirty.has(n.id)) {
      this.d.store.touch(n.namespace);
    }
  }

  async resolveBase(id: string, version: number): Promise<{ id: string; version: number; pending: boolean }> {
    await this.ensureScope();
    const q = await this.d.store.queue();
    const real = q.idMap[id] ?? id;
    const v = resolveBaseVersion(q.selfWrites, real, isLocalId(id) && real !== id ? 0 : version);
    return { id: real, version: v, pending: q.ops.some((o) => o.noteId === real) };
  }

  /* ------------------------------------------------------------ writes */

  async enqueue(edit: OfflineEdit): Promise<OfflineEnqueueResult> {
    await this.ensureScope();
    if (!this.d.enabled()) return { ok: false, note: null, error: "disabled" };
    if (!this.d.store.scoped) return { ok: false, note: null, error: "signed-out" };
    const ns = String(edit?.namespace ?? "");
    if (!ns || !["create", "update", "delete"].includes(edit?.kind)) return { ok: false, note: null, error: "invalid" };
    const q = await this.d.store.queue();
    const doc = await this.d.store.ns(ns);
    const nowIso = new Date(this.now()).toISOString();

    let noteId: string;
    if (edit.kind === "create") noteId = LOCAL_ID_PREFIX + this.newId();
    else {
      if (!edit.id) return { ok: false, note: null, error: "invalid" };
      noteId = q.idMap[edit.id] ?? edit.id;
    }
    const patch = cleanPatch(edit.patch);
    if (edit.kind === "update" && !Object.keys(patch).length) {
      return { ok: true, note: doc.notes[noteId] ?? null };
    }

    // Not cached yet (a brain still on its first pull): adopt the renderer's copy.
    if (edit.kind !== "create" && !doc.notes[noteId] && edit.note) {
      const given = normaliseRemote(edit.note);
      if (given && given.id === noteId) doc.notes[noteId] = { ...given, pending: false };
    }

    let baseVersion = 0;
    if (edit.kind !== "create") {
      baseVersion = isLocalId(edit.id!) && noteId !== edit.id ? 0 : Math.max(0, Number(edit.baseVersion) || 0);
      if (!baseVersion) baseVersion = (doc.shadows[noteId] ?? doc.notes[noteId])?.version ?? 0;
    }
    const server = doc.shadows[noteId] ?? (doc.notes[noteId] && !doc.notes[noteId].pending ? doc.notes[noteId] : undefined);
    const base =
      edit.kind === "update"
        ? { ...(server && server.version === baseVersion ? pickFields(server, patch) : {}), ...cleanPatch(edit.base) }
        : {};

    const op: QueueOp = {
      opId: this.newId(),
      kind: edit.kind,
      namespace: ns,
      noteId,
      baseVersion,
      patch,
      base,
      source: edit.source || "desktop",
      createdAt: nowIso,
      attempts: 0,
      nextAttemptAt: 0,
    };
    const res = coalesce(q.ops, op);
    q.ops = res.queue;

    // Keep the server copy aside while local edits are queued.
    if (!isLocalId(noteId) && doc.notes[noteId] && !doc.shadows[noteId] && !doc.notes[noteId].pending) {
      doc.shadows[noteId] = doc.notes[noteId];
    }
    const view = this.recompute(doc, q, noteId);
    await this.d.store.saveQueue();
    this.d.store.touch(ns);
    this.d.onChange({
      namespace: ns,
      upserted: view ? [view] : [],
      removed: !view && (edit.kind === "delete" || res.dropped.length) ? [noteId] : [],
      reason: "local",
    });
    this.emitStatus();
    this.schedulePush(PUSH_DEBOUNCE_MS);
    return { ok: true, opId: res.op?.opId, note: view };
  }

  async dismissConflict(id: string): Promise<SyncStatus> {
    const q = await this.d.store.queue();
    q.conflicts = q.conflicts.filter((c) => c.id !== id);
    await this.d.store.saveQueue();
    return this.status();
  }

  async clear(includeQueue = false): Promise<SyncStatus> {
    await this.running?.catch(() => undefined);
    await this.d.store.clear(includeQueue);
    this.lastSyncedAt = null;
    this.sizeCache = null;
    this.emitStatus();
    this.d.onChange({ namespace: "*", upserted: [], removed: [], reason: "clear" });
    return this.status();
  }

  /* ------------------------------------------------------------ status */

  async status(): Promise<SyncStatus> {
    const enabled = this.d.enabled();
    const q = this.d.store.scoped ? await this.d.store.queue() : null;
    const namespaces = [];
    if (this.d.store.scoped) {
      const brains = await this.d.store.brains();
      for (const ns of new Set(brains.brains.map((b) => b.namespace))) {
        const doc = await this.d.store.ns(ns);
        namespaces.push({ namespace: ns, notes: Object.keys(doc.notes).length, syncedAt: doc.syncedAt, complete: doc.complete });
      }
    }
    return {
      enabled,
      state: this.state(enabled),
      online: this.online,
      lastSyncedAt: this.lastSyncedAt ?? latest(namespaces.map((n) => n.syncedAt)),
      lastError: this.lastError,
      pending: q?.ops.length ?? 0,
      conflicts: q?.conflicts ?? [],
      pausedReason: this.paused,
      nextSyncAt: this.nextSyncAt ? new Date(this.nextSyncAt).toISOString() : null,
      namespaces,
      cacheBytes: await this.cacheBytes(),
    };
  }

  private sizeCache: { at: number; bytes: number } | null = null;
  /** Disk usage, re-measured at most every 30 s (status is emitted often). */
  private async cacheBytes(): Promise<number> {
    if (this.sizeCache && this.now() - this.sizeCache.at < 30_000) return this.sizeCache.bytes;
    const bytes = await this.d.store.sizeBytes();
    this.sizeCache = { at: this.now(), bytes };
    return bytes;
  }

  private state(enabled: boolean): SyncStatus["state"] {
    if (!enabled) return "disabled";
    if (!this.d.store.scoped || this.authFailed) return "signed-out";
    if (this.running) return "syncing";
    if (this.paused) return "paused";
    if (!this.online) return "offline";
    if (this.lastError) return "error";
    return "idle";
  }

  private emitStatus(): void {
    void this.status().then((s) => this.d.onStatus(s), () => undefined);
  }

  /* --------------------------------------------------------------- run */

  private kick(reason: SyncReason, delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.nextSyncAt = this.now() + delayMs;
    this.timer = setTimeout(() => void this.run(reason), delayMs);
    this.timer.unref?.();
  }

  private schedulePush(delayMs: number): void {
    if (this.stopped) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.run("edit"), delayMs);
    this.pushTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = this.pushTimer = null;
  }

  /** Arrange the next background run after this one. */
  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextSyncAt = null;
    if (!this.d.enabled() || !this.d.store.scoped || this.authFailed) return;
    let delay: number | null;
    if (!this.online) delay = PROBE_MS;
    else if (this.failures) delay = backoffDelay(this.failures, { baseMs: 5_000, maxMs: 5 * 60_000, rand: this.d.rand });
    else if (this.paused) delay = null;
    else {
      const minutes = this.d.intervalMinutes();
      delay = minutes > 0 ? minutes * 60_000 * this.powerFactor : null;
    }
    if (delay === null) return;
    this.nextSyncAt = this.now() + delay;
    this.timer = setTimeout(() => void this.run("timer"), delay);
    this.timer.unref?.();
  }

  private canNetwork(): boolean {
    return this.d.enabled() && this.d.store.scoped && !this.authFailed && this.d.isOnline();
  }

  run(reason: SyncReason): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runOnce(reason).finally(() => {
      this.running = null;
      this.schedule();
      this.emitStatus();
      if (this.again) {
        this.again = false;
        void this.run("edit");
      }
    });
    return this.running;
  }

  private async runOnce(reason: SyncReason): Promise<void> {
    await this.ensureScope();
    if (!this.d.enabled() || !this.d.store.scoped) return;
    if (this.authFailed && reason !== "user" && reason !== "auth") return;
    // Paused (sleep, Low Power Mode): only pushes of fresh edits and explicit syncs.
    const pushOnly = Boolean(this.paused) && reason !== "user";
    if (!this.d.isOnline()) {
      this.online = false;
      return;
    }
    this.emitStatus();
    try {
      await this.pushAll();
      if (!pushOnly && reason !== "edit") {
        const brains = await this.pullBrains();
        const active = brains.map((b) => b.namespace);
        for (const ns of active) await this.pullNamespace(ns);
        await this.pushAll(); // conflict copies created during the pull
        this.lastSyncedAt = new Date(this.now()).toISOString();
      }
      this.online = true;
      this.failures = 0;
      this.lastError = undefined;
    } catch (err) {
      if (err instanceof TransportError) {
        this.online = false;
      } else if (err instanceof AuthError) {
        this.authFailed = true;
        this.lastError = "unauthorized";
      } else {
        this.failures++;
        this.lastError = (err as Error)?.message ?? String(err);
        this.d.log?.("[zekra] sync failed", err);
      }
    } finally {
      await this.d.store.flush();
    }
  }

  /* -------------------------------------------------------------- http */

  private async call(method: string, path: string, json?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: unknown }> {
    let res: HttpResponse;
    try {
      res = await this.d.http(method, path, json, headers);
    } catch (err) {
      throw new TransportError((err as Error)?.message ?? "network");
    }
    let data: unknown = null;
    if (res.body) {
      try {
        data = JSON.parse(res.body);
      } catch {
        data = res.body;
      }
    }
    return { status: res.status, data };
  }

  /* -------------------------------------------------------------- pull */

  private async pullBrains(): Promise<OfflineBrain[]> {
    const { status, data } = await this.call("GET", "/api/brain/mine");
    if (status === 401) throw new AuthError("unauthorized");
    if (status === 0 || status >= 500) throw new TransportError(`brains ${status}`);
    if (status >= 400) throw new Error(`brains: HTTP ${status}`);
    const list = ((data as { brains?: OfflineBrain[] })?.brains ?? []).filter((b) => b && typeof b.namespace === "string");
    await this.d.store.setBrains({ brains: list, fetchedAt: new Date(this.now()).toISOString() });
    return list;
  }

  /** Incremental pull of one brain (since the last serverTime watermark). */
  async pullNamespace(ns: string): Promise<void> {
    const doc = await this.d.store.ns(ns);
    const initial = !doc.complete;
    let cursor: string | undefined;
    let watermark: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ namespace: ns, since: doc.since ?? EPOCH, limit: String(PAGE_LIMIT) });
      if (cursor) qs.set("cursor", cursor);
      const { status, data } = await this.call("GET", `/api/notes?${qs.toString()}`);
      if (status === 401) throw new AuthError("unauthorized");
      if (status === 403 || status === 404) return; // access revoked: keep what we have, stop pulling
      if (status === 0 || status >= 500 || status === 429) throw new TransportError(`notes ${status}`);
      if (status >= 400) {
        // A watermark the server rejects: start this brain over.
        if (doc.since) {
          doc.since = null;
          doc.complete = false;
          this.d.store.touch(ns);
        }
        throw new Error(`notes: HTTP ${status}`);
      }
      const body = data as { notes?: unknown[]; nextCursor?: string; serverTime?: string };
      // The FIRST page's serverTime is the safe next `since`: everything after
      // it is either in a later page of this run or in the next run.
      watermark ??= typeof body.serverTime === "string" ? body.serverTime : null;
      const incoming = (body.notes ?? []).map(normaliseRemote).filter((n): n is OfflineNote => !!n && n.namespace === ns);
      const q = await this.d.store.queue();
      const res = mergeIncoming(doc, incoming, this.dirtyIds(q));
      // Notes with queued edits: their shadow moved; refresh the local view.
      for (const n of incoming) {
        if (doc.shadows[n.id] !== n) continue;
        const view = this.recompute(doc, q, n.id);
        if (view) res.upserted.push(view);
      }
      if (res.upserted.length || res.removed.length) {
        this.d.onChange({ namespace: ns, upserted: res.upserted, removed: res.removed, reason: "pull", initial });
      }
      this.d.store.touch(ns);
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    if (watermark) doc.since = watermark;
    doc.syncedAt = new Date(this.now()).toISOString();
    doc.complete = true;
    this.d.store.touch(ns);
  }

  private async fetchVersions(ns: string, id: string): Promise<OfflineVersions> {
    const { status, data } = await this.call("GET", `/api/notes/${encodeURIComponent(id)}/versions`);
    if (status < 200 || status >= 300) throw new Error(`versions ${status}`);
    const raw = ((data as { versions?: Record<string, unknown>[] })?.versions ?? []) as Record<string, unknown>[];
    const versions: OfflineVersionMeta[] = raw.map((v) => ({
      version: Number(v.version) || 0,
      title: String(v.title ?? ""),
      tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
      pinned: Boolean(v.pinned),
      archived: Boolean(v.archived),
      deleted: Boolean(v.deleted),
      source: String(v.source ?? ""),
      authorUserId: typeof v.authorUserId === "string" ? v.authorUserId : undefined,
      authorAgent: typeof v.authorAgent === "string" ? v.authorAgent : undefined,
      createdAt: String(v.createdAt ?? ""),
    }));
    const out: OfflineVersions = { id, versions, fetchedAt: new Date(this.now()).toISOString() };
    await this.d.store.setVersions(ns, out);
    return out;
  }

  /* -------------------------------------------------------------- push */

  private async pushAll(): Promise<void> {
    for (let guard = 0; guard < 1_000; guard++) {
      const q = await this.d.store.queue();
      const op = nextReady(q.ops, this.now());
      if (!op) {
        const waiting = q.ops.filter((o) => !o.inflight).map((o) => o.nextAttemptAt);
        if (waiting.length) this.schedulePush(Math.max(1_000, Math.min(...waiting) - this.now()));
        return;
      }
      const cont = await this.pushOp(q, op);
      await this.d.store.saveQueue();
      this.emitStatus();
      if (!cont) return;
    }
  }

  /** Push one op. Returns false to stop pushing for now (retry later). */
  private async pushOp(q: QueueDoc, op: QueueOp): Promise<boolean> {
    const doc = await this.d.store.ns(op.namespace);
    if (isLocalId(op.noteId) && q.idMap[op.noteId]) this.renameOps(q, op.noteId, q.idMap[op.noteId]);
    op.inflight = true;
    let status: number;
    let data: unknown;
    try {
      ({ status, data } = await this.send(q, op));
    } catch (err) {
      op.inflight = false;
      if (err instanceof TransportError) this.retryLater(op, 0, err.message);
      throw err;
    }
    op.inflight = false;
    const outcome = classifyStatus(status);
    const current = normaliseRemote((data as { current?: unknown })?.current);

    switch (outcome) {
      case "ok":
        await this.onPushed(q, doc, op, normaliseRemote(data));
        return true;
      case "auth":
        throw new AuthError("unauthorized");
      case "retry":
        this.retryLater(op, status, `HTTP ${status}`);
        return false;
      case "conflict":
        if (op.kind === "update" && current) this.onUpdateConflict(q, doc, op, current);
        else if (op.kind === "delete") this.onDeleteConflict(q, doc, op, current);
        else this.reject(q, doc, op, `HTTP ${status}`);
        return true;
      case "gone":
        if (op.kind === "delete") this.dropOp(q, op);
        else if (op.kind === "update") this.onUpdateGone(q, doc, op);
        else this.reject(q, doc, op, `HTTP ${status}`);
        return true;
      default:
        this.reject(q, doc, op, errorMessage(data) ?? `HTTP ${status}`);
        return true;
    }
  }

  private send(q: QueueDoc, op: QueueOp): Promise<{ status: number; data: unknown }> {
    const id = encodeURIComponent(op.noteId);
    if (op.kind === "create") {
      const p = op.patch;
      return this.call("POST", "/api/notes", {
        namespace: op.namespace,
        title: p.title ?? "",
        body: p.body ?? "",
        tags: p.tags ?? [],
        category: p.category ?? "note",
        pinned: p.pinned ?? false,
        source: op.source,
      });
    }
    const version = resolveBaseVersion(q.selfWrites, op.noteId, op.baseVersion);
    if (op.kind === "delete") {
      return this.call("DELETE", `/api/notes/${id}`, undefined, version ? { "If-Match": `"${version}"` } : undefined);
    }
    return this.call("PUT", `/api/notes/${id}`, { ...op.patch, version, source: op.source });
  }

  private async onPushed(q: QueueDoc, doc: NsDoc, op: QueueOp, server: OfflineNote | null): Promise<void> {
    this.dropOp(q, op);
    if (op.kind === "delete") {
      delete doc.shadows[op.noteId];
      delete doc.notes[op.noteId];
      this.d.store.touch(op.namespace);
      return;
    }
    if (!server) return;
    const idMap: Record<string, string> = {};
    if (op.kind === "create") {
      const local = op.noteId;
      q.idMap[local] = server.id;
      // An editor holding the local note saves with version 0: map it.
      recordSelfWrite(q.selfWrites, server.id, 0, server.version);
      this.renameOps(q, local, server.id);
      delete doc.notes[local];
      idMap[local] = server.id;
      // Fields POST ignores (archived, icon, colour) follow as an update.
      const extra = cleanPatch({ archived: op.patch.archived, icon: op.patch.icon, color: op.patch.color });
      if (extra.archived === false) delete extra.archived;
      if (Object.keys(extra).length) {
        q.ops.unshift({ ...op, opId: this.newId(), kind: "update", noteId: server.id, baseVersion: server.version, patch: extra, base: {}, attempts: 0, nextAttemptAt: 0 });
      }
    } else {
      const sent = resolveBaseVersion(q.selfWrites, op.noteId, op.baseVersion);
      recordSelfWrite(q.selfWrites, server.id, sent, server.version);
    }
    doc.shadows[server.id] = server;
    const view = this.recompute(doc, q, server.id);
    this.d.store.touch(op.namespace);
    this.d.onChange({
      namespace: op.namespace,
      upserted: view ? [view] : [],
      removed: Object.keys(idMap),
      idMap: Object.keys(idMap).length ? idMap : undefined,
      reason: "push",
    });
  }

  private onUpdateConflict(q: QueueDoc, doc: NsDoc, op: QueueOp, current: OfflineNote): void {
    const res = op.attempts > 5 ? null : resolveConflict(op.base, op.patch, current);
    const mine = doc.notes[op.noteId];
    doc.shadows[op.noteId] = current;
    if (!res || res.kind === "fork") {
      const copy = res ? res.copy : { title: mine?.title ?? current.title, body: mine?.body ?? "", tags: mine?.tags ?? [] };
      const copyId = this.forkCopy(q, op, copy);
      this.addConflict(q, { kind: "edit-edit", namespace: op.namespace, noteId: op.noteId, title: current.title || mine?.title || "", copyId });
    }
    const rest = res ? res.patch : {};
    if (Object.keys(rest).length) {
      op.patch = rest;
      op.baseVersion = current.version;
      op.base = pickFields(current, rest);
      op.attempts++;
      op.nextAttemptAt = 0;
    } else {
      this.dropOp(q, op);
    }
    const view = this.recompute(doc, q, op.noteId);
    this.d.store.touch(op.namespace);
    this.d.onChange({ namespace: op.namespace, upserted: view ? [view] : [], removed: view ? [] : [op.noteId], reason: "conflict" });
  }

  private onDeleteConflict(q: QueueDoc, doc: NsDoc, op: QueueOp, current: OfflineNote | null): void {
    // Deleted here, edited there: the edit wins; the note comes back.
    this.dropOp(q, op);
    if (current && !current.deleted) {
      delete doc.shadows[op.noteId];
      doc.notes[op.noteId] = current;
      this.addConflict(q, { kind: "delete-edited", namespace: op.namespace, noteId: op.noteId, title: current.title });
      this.d.onChange({ namespace: op.namespace, upserted: [current], removed: [], reason: "conflict" });
    }
    this.d.store.touch(op.namespace);
  }

  private onUpdateGone(q: QueueDoc, doc: NsDoc, op: QueueOp): void {
    // Edited here, deleted there: keep ours as a new note.
    const mine = doc.notes[op.noteId];
    const ops = q.ops.filter((o) => o.noteId === op.noteId);
    for (const o of ops) this.dropOp(q, o);
    const copyId = this.forkCopy(q, op, {
      title: mine?.title ?? op.patch.title ?? "",
      body: mine?.body ?? op.patch.body ?? "",
      tags: mine?.tags ?? op.patch.tags ?? [],
      category: mine?.category,
    });
    this.addConflict(q, { kind: "edit-deleted", namespace: op.namespace, noteId: op.noteId, title: mine?.title ?? "", copyId });
    delete doc.notes[op.noteId];
    delete doc.shadows[op.noteId];
    this.d.store.touch(op.namespace);
    this.d.onChange({ namespace: op.namespace, upserted: [], removed: [op.noteId], reason: "conflict" });
  }

  private reject(q: QueueDoc, doc: NsDoc, op: QueueOp, message: string): void {
    // The server will never take this op; drop it and every later op of the
    // same note (they build on it), and go back to the server copy.
    for (const o of q.ops.filter((x) => x.noteId === op.noteId)) this.dropOp(q, o);
    const title = doc.notes[op.noteId]?.title ?? op.patch.title ?? "";
    const server = doc.shadows[op.noteId];
    delete doc.shadows[op.noteId];
    if (server) doc.notes[op.noteId] = server;
    else delete doc.notes[op.noteId];
    this.addConflict(q, { kind: "rejected", namespace: op.namespace, noteId: op.noteId, title, message });
    this.d.store.touch(op.namespace);
    this.d.onChange({
      namespace: op.namespace,
      upserted: server ? [server] : [],
      removed: server ? [] : [op.noteId],
      reason: "conflict",
    });
  }

  /** Queue a "conflicted copy" note with our text; returns its local id. */
  private forkCopy(q: QueueDoc, op: QueueOp, fields: QueueOp["patch"]): string {
    const id = LOCAL_ID_PREFIX + this.newId();
    const label = this.d.conflictLabel?.() ?? "conflicted copy";
    const patch = cleanPatch({ ...fields, title: conflictCopyTitle(fields.title ?? "", new Date(this.now()), label) });
    q.ops.push({
      opId: this.newId(),
      kind: "create",
      namespace: op.namespace,
      noteId: id,
      baseVersion: 0,
      patch,
      base: {},
      source: op.source,
      createdAt: new Date(this.now()).toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
    });
    void this.d.store.ns(op.namespace).then((doc) => {
      const view = this.recompute(doc, q, id);
      if (view) this.d.onChange({ namespace: op.namespace, upserted: [view], removed: [], reason: "conflict" });
    });
    return id;
  }

  private addConflict(q: QueueDoc, c: Omit<SyncConflict, "id" | "at">): void {
    q.conflicts = [{ ...c, id: this.newId(), at: new Date(this.now()).toISOString() }, ...q.conflicts].slice(0, MAX_CONFLICTS);
  }

  private retryLater(op: QueueOp, status: number, message: string): void {
    op.attempts++;
    op.lastError = message;
    op.nextAttemptAt = this.now() + backoffDelay(op.attempts, { rand: this.d.rand });
    if (status === 0) this.online = false;
  }

  private dropOp(q: QueueDoc, op: QueueOp): void {
    q.ops = q.ops.filter((o) => o.opId !== op.opId);
  }

  private renameOps(q: QueueDoc, from: string, to: string): void {
    for (const o of q.ops) if (o.noteId === from) o.noteId = to;
  }

  private dirtyIds(q: QueueDoc): Set<string> {
    return new Set(q.ops.map((o) => o.noteId));
  }

  /** Rebuild the cached (optimistic) view of one note; drops the shadow
   *  once no edits are queued. Returns the view (null = gone). */
  private recompute(doc: NsDoc, q: QueueDoc, id: string): OfflineNote | null {
    const ops = q.ops.filter((o) => o.noteId === id);
    const server = doc.shadows[id] ?? (ops.length ? undefined : doc.notes[id]);
    const base = server ?? (doc.notes[id] && !isLocalId(id) ? { ...doc.notes[id], pending: false } : undefined);
    const view = localView(base, ops, new Date(this.now()).toISOString());
    if (!ops.length) delete doc.shadows[id];
    if (view) {
      if (!ops.length) {
        delete view.pending;
        delete view.localOnly;
      }
      doc.notes[id] = view;
    } else delete doc.notes[id];
    return view;
  }

  /* ------------------------------------------------------------- scope */

  /** Point the store at the signed-in account. Returns true if it changed. */
  private async ensureScope(): Promise<boolean> {
    const a = this.d.auth();
    const ok = this.d.enabled() && Boolean(a.token && a.userId);
    const key = ok ? `${a.apiBaseUrl}\n${a.userId}` : "";
    if (key === this.scopeKey) {
      // Another caller may be switching to this scope right now: wait for it.
      await this.scoping;
      return false;
    }
    // Key + promise are set in the same tick, so a concurrent caller sees both.
    this.scopeKey = key;
    this.scoping = this.d.store.setScope(ok ? { apiBaseUrl: a.apiBaseUrl, userId: a.userId!, email: a.email } : null);
    await this.scoping;
    this.lastSyncedAt = null;
    return true;
  }

  private newId(): string {
    if (this.d.newId) return this.d.newId();
    return `${this.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function latest(xs: (string | null)[]): string | null {
  let best: string | null = null;
  for (const x of xs) if (x && (!best || x > best)) best = x;
  return best;
}

function errorMessage(data: unknown): string | undefined {
  const v = data as { error?: unknown; message?: unknown } | null;
  if (!v || typeof v !== "object") return undefined;
  if (typeof v.error === "string") return v.error;
  const nested = v.error as { message?: unknown } | undefined;
  if (nested && typeof nested.message === "string") return nested.message;
  return typeof v.message === "string" ? v.message : undefined;
}
