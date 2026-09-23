import assert from "node:assert/strict"
import { test } from "node:test"

import { groupNotes, listDate, rowSnippet } from "./note-groups.ts"

const now = new Date(2026, 8, 23, 15, 0).getTime()
const at = (y: number, m: number, d: number) => new Date(y, m, d, 9, 0).toISOString()
const n = (id: string, updatedAt: string, pinned = false) => ({ id, pinned, updatedAt, createdAt: updatedAt })

test("groups by day like the desktop list, pinned first", () => {
  const notes = [
    n("p", at(2026, 0, 1), true),
    n("t", at(2026, 8, 23)),
    n("y", at(2026, 8, 22)),
    n("w", at(2026, 8, 18)),
    n("m", at(2026, 8, 1)),
    n("cal", at(2026, 5, 10)),
    n("old", at(2024, 2, 2)),
  ]
  const groups = groupNotes(notes, { pinnedFirst: true, sort: "updated", now })
  assert.deepEqual(groups.map((g) => g.kind), ["pinned", "today", "yesterday", "week", "month", "calendarMonth", "year"])
  assert.equal(groups[5].month, 5)
  assert.equal(groups[6].year, 2024)
  // Without pinnedFirst the pinned note sits in its date group.
  assert.equal(groupNotes(notes, { pinnedFirst: false, sort: "updated", now })[0].kind, "calendarMonth")
})

test("title sort is one unlabelled group; empty is no groups", () => {
  assert.deepEqual(groupNotes([n("a", at(2026, 8, 23))], { pinnedFirst: true, sort: "title", now }).map((g) => g.kind), ["all"])
  assert.deepEqual(groupNotes([], { pinnedFirst: true, sort: "title", now }), [])
})

test("listDate: time today, Yesterday, then dates", () => {
  assert.equal(listDate(at(2026, 8, 22), "en", "Yesterday", now), "Yesterday")
  assert.match(listDate(at(2026, 8, 23), "en", "Yesterday", now), /9:00/)
  assert.equal(listDate("nope", "en", "Yesterday", now), "")
})

test("rowSnippet prefers the description, else plain body text", () => {
  assert.equal(rowSnippet({ description: " Summary ", body: "# Body" }), "Summary")
  assert.equal(rowSnippet({ body: "# Title\n\nSee [the docs](https://x) and [[Node]] `code`" }), "Title See the docs and Node code")
  assert.equal(rowSnippet({ body: "\\[a.md\\] snake\\_case" }), "[a.md] snake_case")
})
