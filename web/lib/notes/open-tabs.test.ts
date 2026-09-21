import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"

import {
  MAX_TABS,
  closeTab,
  coerceTabs,
  loadTabs,
  nextSelection,
  openTab,
  renameTab,
} from "./open-tabs.ts"

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true })
})

describe("coercion", () => {
  test("non-arrays and junk entries yield nothing", () => {
    assert.deepEqual(coerceTabs(null), [])
    assert.deepEqual(coerceTabs([null, 3, "x", {}]), [])
  })

  test("duplicate ids collapse", () => {
    const got = coerceTabs([
      { id: "a", title: "A" },
      { id: "a", title: "A again" },
    ])
    assert.equal(got.length, 1)
  })

  test("a missing title becomes empty rather than undefined", () => {
    assert.equal(coerceTabs([{ id: "a" }])[0].title, "")
  })

  test("stored lists longer than the cap are trimmed on read", () => {
    const many = Array.from({ length: MAX_TABS + 4 }, (_, i) => ({ id: `n${i}`, title: "" }))
    assert.equal(coerceTabs(many).length, MAX_TABS)
  })
})

describe("opening", () => {
  test("appends in order", () => {
    openTab("ns", { id: "a", title: "A" })
    const got = openTab("ns", { id: "b", title: "B" })
    assert.deepEqual(got.map((x) => x.id), ["a", "b"])
  })

  test("re-opening keeps position rather than jumping to the end", () => {
    openTab("ns", { id: "a", title: "A" })
    openTab("ns", { id: "b", title: "B" })
    const got = openTab("ns", { id: "a", title: "A" })
    assert.deepEqual(got.map((x) => x.id), ["a", "b"])
  })

  test("re-opening adopts a new title", () => {
    openTab("ns", { id: "a", title: "Old" })
    const got = openTab("ns", { id: "a", title: "New" })
    assert.equal(got[0].title, "New")
  })

  test("tabs are per brain", () => {
    openTab("one", { id: "a", title: "A" })
    openTab("two", { id: "b", title: "B" })
    assert.deepEqual(loadTabs("one").map((x) => x.id), ["a"])
    assert.deepEqual(loadTabs("two").map((x) => x.id), ["b"])
  })

  test("eviction never drops the tab being opened", () => {
    for (let i = 0; i < MAX_TABS; i++) openTab("ns", { id: `n${i}`, title: "" })
    const got = openTab("ns", { id: "fresh", title: "Fresh" })
    assert.equal(got.length, MAX_TABS)
    assert.ok(got.some((x) => x.id === "fresh"), "the newly opened tab was evicted")
    // The oldest went instead.
    assert.ok(!got.some((x) => x.id === "n0"))
  })
})

describe("closing and renaming", () => {
  test("close removes only that tab", () => {
    openTab("ns", { id: "a", title: "A" })
    openTab("ns", { id: "b", title: "B" })
    assert.deepEqual(closeTab("ns", "a").map((x) => x.id), ["b"])
  })

  test("closing something not open is a no-op, not an error", () => {
    openTab("ns", { id: "a", title: "A" })
    assert.deepEqual(closeTab("ns", "zzz").map((x) => x.id), ["a"])
  })

  test("rename only touches an open tab", () => {
    openTab("ns", { id: "a", title: "A" })
    assert.equal(renameTab("ns", "a", "Renamed")[0].title, "Renamed")
    assert.deepEqual(renameTab("ns", "nope", "X").map((x) => x.id), ["a"])
  })
})

describe("selection after close", () => {
  const tabs = [
    { id: "a", title: "" },
    { id: "b", title: "" },
    { id: "c", title: "" },
  ]

  test("closing an inactive tab does not move the selection", () => {
    assert.equal(nextSelection(tabs, "a", "c"), "c")
  })

  test("closing the active tab falls to the left neighbour", () => {
    assert.equal(nextSelection(tabs, "b", "b"), "a")
  })

  test("closing the first tab falls to the right", () => {
    assert.equal(nextSelection(tabs, "a", "a"), "b")
  })

  test("closing the only tab selects nothing", () => {
    assert.equal(nextSelection([{ id: "a", title: "" }], "a", "a"), null)
  })

  test("closing a tab that is not in the list yields nothing rather than throwing", () => {
    assert.equal(nextSelection(tabs, "zzz", "zzz"), null)
  })
})
