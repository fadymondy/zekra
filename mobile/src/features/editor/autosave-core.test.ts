import assert from "node:assert/strict";
import { test } from "node:test";

import { Autosaver, type SaveOutcome, type Timers } from "./autosave-core.ts";

/** Manual clock: nothing fires until tick(). */
function clock() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  return {
    timers,
    async tick(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

test("saves once, delay after the LAST change", async () => {
  const c = clock();
  const saved: string[] = [];
  const a = new Autosaver<string>({ delay: 800, timers: c.timers, save: async (s) => (saved.push(s), { ok: true }) });
  a.change("a");
  await c.tick(500);
  a.change("ab");
  await c.tick(500);
  assert.deepEqual(saved, []);
  await c.tick(300);
  assert.deepEqual(saved, ["ab"]);
  assert.equal(a.status, "saved");
});

test("changes during a save are saved next, with the newest text", async () => {
  const c = clock();
  const saved: string[] = [];
  let release!: () => void;
  const a = new Autosaver<string>({
    delay: 100,
    timers: c.timers,
    save: (s) => {
      saved.push(s);
      return saved.length === 1 ? new Promise<SaveOutcome>((r) => (release = () => r({ ok: true }))) : Promise.resolve({ ok: true });
    },
  });
  a.change("one");
  await c.tick(100);
  assert.equal(a.status, "saving");
  a.change("two");
  a.change("three");
  release();
  await settle();
  await c.tick(100);
  assert.deepEqual(saved, ["one", "three"]);
  assert.equal(a.status, "saved");
});

test("flush saves immediately and waits for it", async () => {
  const c = clock();
  const saved: string[] = [];
  const a = new Autosaver<string>({ delay: 800, timers: c.timers, save: async (s) => (saved.push(s), { ok: true }) });
  a.change("x");
  await a.flush();
  assert.deepEqual(saved, ["x"]);
  await c.tick(1000);
  assert.deepEqual(saved, ["x"], "the scheduled save was cancelled");
});

test("conflict stops autosave until resolved", async () => {
  const c = clock();
  const saved: string[] = [];
  let conflict = true;
  const a = new Autosaver<string>({
    delay: 100,
    timers: c.timers,
    save: async (s) => {
      saved.push(s);
      return conflict ? { ok: false, conflict: true, error: "409" } : { ok: true };
    },
  });
  a.change("mine");
  await c.tick(100);
  assert.equal(a.status, "conflict");
  a.change("mine more");
  await c.tick(1000);
  await a.flush();
  assert.deepEqual(saved, ["mine"], "no saves while in conflict");
  conflict = false;
  a.resolved({ dirty: true, snapshot: "mine more" });
  await c.tick(100);
  assert.deepEqual(saved, ["mine", "mine more"]);
  assert.equal(a.status, "saved");
});

test("errors keep the text dirty for a retry", async () => {
  const c = clock();
  let fail = true;
  const saved: string[] = [];
  const a = new Autosaver<string>({
    delay: 100,
    timers: c.timers,
    save: async (s) => {
      if (fail) throw new Error("offline");
      saved.push(s);
      return { ok: true };
    },
  });
  a.change("t");
  await c.tick(100);
  assert.equal(a.status, "error");
  assert.equal(a.lastError, "offline");
  assert.equal(a.isDirty, true);
  fail = false;
  await a.flush();
  assert.deepEqual(saved, ["t"]);
  assert.equal(a.status, "saved");
});

test("a skipped save (empty new note) reports idle", async () => {
  const c = clock();
  const a = new Autosaver<string>({ delay: 10, timers: c.timers, save: async () => ({ ok: true, skipped: true }) });
  a.change("");
  await c.tick(10);
  assert.equal(a.status, "idle");
});
