// The sync engine end to end under plain node: a fake Zekra notes API (the
// contract of plugins/brain/internal/brain/notes_handlers.go), the real
// on-disk store in a temp dir, no Electron. Covers the incremental pull,
// offline edits + push, the 409 "keep both" and rebase paths, create/delete
// coalescing, and persistence across a restart.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const out = path.join(__dirname, "..", "out");
const { SyncEngine } = require(path.join(out, "main/offline/engine.js"));
const { OfflineStore } = require(path.join(out, "main/offline/store.js"));

/* ------------------------------------------------------- fake server */

function fakeServer() {
  const s = {
    online: true,
    clock: Date.parse("2026-09-01T00:00:00Z"),
    notes: new Map(),
    calls: [],
    seq: 0,
    brains: [{ namespace: "ns", role: "owner", canWrite: true, memories: 0 }],
  };
  const tick = () => new Date((s.clock += 1000)).toISOString();
  s.put = (fields) => {
    const id = fields.id ?? `00000000-0000-4000-8000-${String(++s.seq).padStart(12, "0")}`;
    const n = { namespace: "ns", title: "", body: "", tags: [], category: "note", pinned: false, archived: false, indexed: true, chunks: 1, version: 1, deleted: false, ...fields, id, updatedAt: tick() };
    s.notes.set(id, n);
    return n;
  };
  s.http = async (method, p, json, headers = {}) => {
    s.calls.push(`${method} ${p}`);
    if (!s.online) throw new Error("net::ERR_INTERNET_DISCONNECTED");
    const url = new URL(p, "https://x.test");
    const reply = (status, body) => ({ status, body: JSON.stringify(body) });
    if (url.pathname === "/api/brain/mine") return reply(200, { brains: s.brains });
    if (url.pathname === "/api/notes" && method === "GET") {
      const since = url.searchParams.get("since");
      const limit = Number(url.searchParams.get("limit"));
      const cursor = url.searchParams.get("cursor");
      let rows = [...s.notes.values()].filter((n) => n.updatedAt > since).sort((a, b) => (a.updatedAt + a.id).localeCompare(b.updatedAt + b.id));
      if (cursor) rows = rows.filter((n) => n.updatedAt + n.id > cursor);
      const page = rows.slice(0, limit).map((n) => (n.deleted ? { ...n, body: "" } : n));
      const next = rows.length > limit ? page[page.length - 1].updatedAt + page[page.length - 1].id : undefined;
      return reply(200, { notes: page, nextCursor: next, serverTime: new Date(s.clock - 5000).toISOString() });
    }
    if (url.pathname === "/api/notes" && method === "POST") {
      return reply(201, s.put({ title: json.title, body: json.body, tags: json.tags, pinned: json.pinned, source: json.source }));
    }
    const m = /^\/api\/notes\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const cur = s.notes.get(id);
      if (!cur || cur.deleted) return reply(404, { error: { code: "not_found" } });
      const expect = method === "DELETE" ? Number(String(headers["If-Match"] ?? "0").replace(/"/g, "")) : Number(json.version || 0);
      if (expect > 0 && expect !== cur.version) return reply(409, { error: { code: "conflict" }, current: cur });
      if (method === "DELETE") {
        const gone = { ...cur, deleted: true, version: cur.version + 1, updatedAt: tick() };
        s.notes.set(id, gone);
        return reply(200, gone);
      }
      const { version: _v, source: _s, ...patch } = json;
      const next = { ...cur, ...patch, version: cur.version + 1, updatedAt: tick() };
      s.notes.set(id, next);
      return reply(200, next);
    }
    return reply(404, {});
  };
  return s;
}

function makeEngine(server, dir) {
  let n = 0;
  const changes = [];
  const engine = new SyncEngine({
    store: new OfflineStore(dir, 5),
    http: (...a) => server.http(...a),
    auth: () => ({ apiBaseUrl: "https://x.test", token: "tok", userId: "u1" }),
    enabled: () => true,
    intervalMinutes: () => 0,
    isOnline: () => true,
    onStatus: () => {},
    onChange: (e) => changes.push(e),
    now: () => server.clock,
    rand: () => 0.5,
    newId: () => `id${++n}`,
  });
  return { engine, changes };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "zekra-sync-test-"));

/* ------------------------------------------------------------- tests */

test("initial pull caches every note; incremental pull applies changes and tombstones", async () => {
  const server = fakeServer();
  const a = server.put({ title: "A" });
  const b = server.put({ title: "B" });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  let res = await engine.notes("ns");
  assert.equal(res.total, 2);
  assert.equal(res.complete, true);
  assert.ok(res.syncedAt);

  server.notes.set(a.id, { ...a, title: "A2", version: 2, updatedAt: new Date((server.clock += 1000)).toISOString() });
  server.notes.set(b.id, { ...b, deleted: true, version: 2, updatedAt: new Date((server.clock += 1000)).toISOString() });
  server.calls.length = 0;
  await engine.syncNow();
  const pull = server.calls.find((c) => c.startsWith("GET /api/notes?"));
  assert.match(pull, /since=2026-0/); // the last serverTime, not the epoch: incremental
  assert.doesNotMatch(pull, /since=1970/);
  res = await engine.notes("ns");
  assert.deepEqual(res.notes.map((n) => n.title), ["A2"]);
});

test("paged pull follows nextCursor", async () => {
  const server = fakeServer();
  for (let i = 0; i < 450; i++) server.put({ title: `n${i}` });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  assert.equal((await engine.notes("ns", { limit: 1000 })).total, 450);
  assert.equal(server.calls.filter((c) => c.startsWith("GET /api/notes?")).length, 3);
});

test("offline edit is queued, shown optimistically, pushed later; the editor's base is rebased", async () => {
  const server = fakeServer();
  const a = server.put({ title: "A", body: "one" });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();

  server.online = false;
  const r = await engine.enqueue({ kind: "update", namespace: "ns", id: a.id, baseVersion: 1, patch: { body: "two" } });
  assert.equal(r.ok, true);
  assert.equal(r.note.body, "two");
  assert.equal(r.note.pending, true);
  await engine.enqueue({ kind: "update", namespace: "ns", id: a.id, baseVersion: 1, patch: { body: "three" } });
  let st = await engine.status();
  assert.equal(st.pending, 1); // coalesced
  await engine.run("user");
  st = await engine.status();
  assert.equal(st.state, "offline");
  assert.equal(st.pending, 1);

  server.online = true;
  server.calls.length = 0;
  await engine.syncNow();
  st = await engine.status();
  assert.equal(st.pending, 0);
  assert.equal(server.notes.get(a.id).body, "three");
  assert.equal(server.notes.get(a.id).version, 2);
  assert.equal(server.calls.filter((c) => c.startsWith("PUT")).length, 1);
  // An editor still holding v1 now saves against v2, not into a self-409.
  assert.deepEqual(await engine.resolveBase(a.id, 1), { id: a.id, version: 2, pending: false });
  const cached = await engine.note("ns", a.id);
  assert.equal(cached.version, 2);
  assert.equal(cached.pending, undefined);
});

test("409 on disjoint fields rebases and succeeds", async () => {
  const server = fakeServer();
  const a = server.put({ title: "A", body: "orig" });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  server.online = false;
  await engine.enqueue({ kind: "update", namespace: "ns", id: a.id, baseVersion: 1, patch: { body: "mine" } });
  // Meanwhile someone pinned it.
  server.notes.set(a.id, { ...server.notes.get(a.id), pinned: true, version: 2, updatedAt: new Date((server.clock += 1000)).toISOString() });
  server.online = true;
  await engine.syncNow();
  const n = server.notes.get(a.id);
  assert.equal(n.body, "mine");
  assert.equal(n.pinned, true);
  assert.equal((await engine.status()).conflicts.length, 0);
});

test("409 on the same text keeps both: server text stays, ours becomes a conflicted copy", async () => {
  const server = fakeServer();
  const a = server.put({ title: "Plan", body: "orig" });
  const { engine, changes } = makeEngine(server, tmp());
  await engine.syncNow();
  server.online = false;
  await engine.enqueue({ kind: "update", namespace: "ns", id: a.id, baseVersion: 1, patch: { body: "mine" } });
  server.notes.set(a.id, { ...server.notes.get(a.id), body: "theirs", version: 2, updatedAt: new Date((server.clock += 1000)).toISOString() });
  server.online = true;
  await engine.syncNow();

  assert.equal(server.notes.get(a.id).body, "theirs");
  const copy = [...server.notes.values()].find((n) => n.id !== a.id);
  assert.ok(copy, "a conflicted copy was created");
  assert.equal(copy.body, "mine");
  assert.match(copy.title, /^Plan \(conflicted copy /);
  const st = await engine.status();
  assert.equal(st.pending, 0);
  assert.equal(st.conflicts.length, 1);
  assert.equal(st.conflicts[0].kind, "edit-edit");
  const cached = await engine.notes("ns");
  assert.equal(cached.total, 2);
  assert.ok(!cached.notes.some((n) => n.id.startsWith("local:")));
  assert.ok(changes.some((c) => c.idMap && Object.values(c.idMap).includes(copy.id)));
  assert.equal((await engine.dismissConflict(st.conflicts[0].id)).conflicts.length, 0);
});

test("offline create + edits push as ONE create; create + delete never reaches the server", async () => {
  const server = fakeServer();
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  server.online = false;
  const c = await engine.enqueue({ kind: "create", namespace: "ns", patch: { title: "Idea", tags: ["x"] } });
  assert.match(c.note.id, /^local:/);
  await engine.enqueue({ kind: "update", namespace: "ns", id: c.note.id, patch: { body: "details" } });
  const d = await engine.enqueue({ kind: "create", namespace: "ns", patch: { title: "Throwaway" } });
  await engine.enqueue({ kind: "delete", namespace: "ns", id: d.note.id });
  assert.equal((await engine.status()).pending, 1);

  server.online = true;
  server.calls.length = 0;
  await engine.syncNow();
  assert.equal(server.calls.filter((x) => x.startsWith("POST")).length, 1);
  const created = [...server.notes.values()][0];
  assert.equal(created.title, "Idea");
  assert.equal(created.body, "details");
  // The editor still holding the local id is mapped to the server note.
  const rb = await engine.resolveBase(c.note.id, 0);
  assert.equal(rb.id, created.id);
  assert.equal(rb.version, 1);
});

test("delete vs remote edit: the edit wins and the note comes back", async () => {
  const server = fakeServer();
  const a = server.put({ title: "Keep me" });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  server.online = false;
  await engine.enqueue({ kind: "delete", namespace: "ns", id: a.id, baseVersion: 1 });
  assert.equal((await engine.notes("ns")).total, 0);
  server.notes.set(a.id, { ...server.notes.get(a.id), body: "edited", version: 2, updatedAt: new Date((server.clock += 1000)).toISOString() });
  server.online = true;
  await engine.syncNow();
  assert.equal(server.notes.get(a.id).deleted, false);
  const res = await engine.notes("ns");
  assert.equal(res.total, 1);
  assert.equal(res.notes[0].body, "edited");
  assert.equal((await engine.status()).conflicts[0].kind, "delete-edited");
});

test("edit of a note deleted remotely keeps our text as a new note", async () => {
  const server = fakeServer();
  const a = server.put({ title: "Gone", body: "x" });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  server.online = false;
  await engine.enqueue({ kind: "update", namespace: "ns", id: a.id, baseVersion: 1, patch: { body: "my words" } });
  server.notes.set(a.id, { ...server.notes.get(a.id), deleted: true, version: 2, updatedAt: new Date((server.clock += 1000)).toISOString() });
  server.online = true;
  await engine.syncNow();
  const copy = [...server.notes.values()].find((n) => !n.deleted);
  assert.equal(copy.body, "my words");
  assert.equal((await engine.status()).conflicts[0].kind, "edit-deleted");
});

test("cache and outbox survive a restart", async () => {
  const server = fakeServer();
  server.put({ title: "Persisted" });
  const dir = tmp();
  const first = makeEngine(server, dir).engine;
  await first.syncNow();
  server.online = false;
  const c = await first.enqueue({ kind: "create", namespace: "ns", patch: { title: "Offline idea" } });
  assert.ok(c.ok);
  await first.stop();

  const second = makeEngine(server, dir).engine;
  const res = await second.notes("ns");
  assert.equal(res.total, 2);
  assert.equal((await second.status()).pending, 1);
  server.online = true;
  await second.syncNow();
  assert.ok([...server.notes.values()].some((n) => n.title === "Offline idea"));
  // Files are private to the user.
  const scopeDir = fs.readdirSync(path.join(dir, "v1"))[0];
  const mode = fs.statSync(path.join(dir, "v1", scopeDir, "queue.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("clear() drops the cache but keeps unsynced edits", async () => {
  const server = fakeServer();
  const a = server.put({ title: "A" });
  const { engine } = makeEngine(server, tmp());
  await engine.syncNow();
  server.online = false;
  await engine.enqueue({ kind: "update", namespace: "ns", id: a.id, baseVersion: 1, patch: { title: "A!" } });
  await engine.clear(false);
  assert.equal((await engine.notes("ns")).total, 0);
  assert.equal((await engine.status()).pending, 1);
  server.online = true;
  await engine.syncNow();
  assert.equal(server.notes.get(a.id).title, "A!");
  assert.equal((await engine.notes("ns")).total, 1);
});
