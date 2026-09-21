import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"

import { MAX_RECENT, coerceRecent, forgetRecent, loadRecent, pushRecent } from "./recent-notes.ts"

/*
The store is read from localStorage, which is user-writable, so coercion is
the part worth testing. A corrupt entry must not break the spotlight — the
section is a convenience and should degrade to empty, never throw.
*/

/** Minimal localStorage stand-in; Node has none. */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true })
})

describe("coercion", () => {
  test("non-arrays yield an empty list", () => {
    assert.deepEqual(coerceRecent(null), [])
    assert.deepEqual(coerceRecent({}), [])
    assert.deepEqual(coerceRecent("junk"), [])
  })

  test("entries missing an id or namespace are dropped", () => {
    const got = coerceRecent([
      { id: "a", namespace: "ns", title: "A", at: 1 },
      { id: "", namespace: "ns", title: "empty", at: 2 },
      { namespace: "ns", title: "no id", at: 3 },
      { id: "b", title: "no ns", at: 4 },
    ])
    assert.deepEqual(got.map((r) => r.id), ["a"])
  })

  test("a non-numeric timestamp is dropped rather than sorted as NaN", () => {
    const got = coerceRecent([{ id: "a", namespace: "ns", title: "A", at: "soon" }])
    assert.deepEqual(got, [])
  })

  test("a missing title becomes empty rather than undefined", () => {
    const got = coerceRecent([{ id: "a", namespace: "ns", at: 1 }])
    assert.equal(got[0].title, "")
  })

  test("newest first", () => {
    const got = coerceRecent([
      { id: "old", namespace: "ns", title: "", at: 1 },
      { id: "new", namespace: "ns", title: "", at: 99 },
    ])
    assert.deepEqual(got.map((r) => r.id), ["new", "old"])
  })

  test("the list is capped", () => {
    const many = Array.from({ length: MAX_RECENT + 5 }, (_, i) => ({
      id: `n${i}`,
      namespace: "ns",
      title: "",
      at: i,
    }))
    assert.equal(coerceRecent(many).length, MAX_RECENT)
  })
})

describe("push and forget", () => {
  test("a new note lands at the top", () => {
    pushRecent({ id: "a", namespace: "ns", title: "A" })
    const got = pushRecent({ id: "b", namespace: "ns", title: "B" })
    assert.deepEqual(got.map((r) => r.id), ["b", "a"])
  })

  test("re-opening moves rather than duplicates", () => {
    pushRecent({ id: "a", namespace: "ns", title: "A" })
    pushRecent({ id: "b", namespace: "ns", title: "B" })
    const got = pushRecent({ id: "a", namespace: "ns", title: "A" })
    assert.deepEqual(got.map((r) => r.id), ["a", "b"])
    assert.equal(got.filter((r) => r.id === "a").length, 1)
  })

  test("a renamed note takes its new title", () => {
    pushRecent({ id: "a", namespace: "ns", title: "Old" })
    const got = pushRecent({ id: "a", namespace: "ns", title: "New" })
    assert.equal(got[0].title, "New")
  })

  test("forget removes a deleted note so the list cannot rot", () => {
    pushRecent({ id: "a", namespace: "ns", title: "A" })
    pushRecent({ id: "b", namespace: "ns", title: "B" })
    assert.deepEqual(forgetRecent("a").map((r) => r.id), ["b"])
  })

  test("corrupt stored JSON degrades to empty instead of throwing", () => {
    localStorage.setItem("zekra.recent-notes", "{not json")
    assert.deepEqual(loadRecent(), [])
  })

  test("blocked storage does not break an open", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceeded")
        },
        removeItem: () => {},
      },
      configurable: true,
    })
    assert.doesNotThrow(() => pushRecent({ id: "a", namespace: "ns", title: "A" }))
  })
})
