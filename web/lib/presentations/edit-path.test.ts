import assert from "node:assert/strict"
import { test } from "node:test"

import { blankLike, convertType, errorsUnder, freshId, getIn, historyOf, insertAt, parsePath, record, redo, removeAt, setIn, undo } from "./edit-path.ts"
import { ITEM_TEMPLATES, localized } from "./templates.ts"

test("paths: the API's error locations and the viewers' dotted paths parse alike", () => {
  assert.deepEqual(parsePath("content.slides[1].bullets[0]"), ["content", "slides", 1, "bullets", 0])
  assert.deepEqual(parsePath("steps.2.title"), ["steps", 2, "title"])
  assert.deepEqual(parsePath(""), [])
})

test("setIn copies only the containers on the way and leaves the rest shared", () => {
  const doc = { title: "t", slides: [{ type: "title", title: "a" }, { type: "bullets", title: "b", bullets: ["x", { text: "y", icon: "zap" }] }] }
  const next = setIn(doc, ["slides", 1, "bullets", 1, "text"], "z")
  assert.equal(getIn(next, ["slides", 1, "bullets", 1, "text"]), "z")
  assert.equal(getIn(doc, ["slides", 1, "bullets", 1, "text"]), "y", "the original is untouched")
  assert.equal(next.slides[0], doc.slides[0], "an unrelated slide keeps its identity (thumbnails are memoised on it)")
  assert.notEqual(next.slides[1], doc.slides[1])
})

test("setIn with undefined removes an optional field instead of storing it", () => {
  const next = setIn({ type: "title", title: "a", subtitle: "s" }, ["subtitle"], undefined)
  assert.deepEqual(next, { type: "title", title: "a" })
})

test("list edits: insert after, remove, and a blank sibling of the same shape", () => {
  const doc = { bullets: ["a", "b"] }
  assert.deepEqual(insertAt(doc, ["bullets"], 1, "").bullets, ["a", "", "b"])
  assert.deepEqual(removeAt(doc, ["bullets"], 0).bullets, ["b"])
  assert.equal(blankLike("text"), "")
  assert.deepEqual(blankLike({ text: "y", icon: "zap" }), { text: "", icon: "" })
  assert.deepEqual(blankLike({ cells: ["a", "b"], status: "Done" }), { cells: ["", ""], status: "" })
  assert.equal(freshId([{ id: "step-1" }, { id: "step-3" }], "step"), "step-4")
})

test("errorsUnder: errors are placed on their item, relative to it", () => {
  const errors = [
    { path: "content.slides[1].bullets[0]", message: "must not be empty", hint: "fix the value at this path" },
    { path: "content.slides[2].frame", message: "must be one of: browser, app, tablet, desktop" },
    { path: "content.title", message: "is required" },
  ]
  assert.deepEqual(errorsUnder(errors, ["slides", 1]), [{ path: ["bullets", 0], message: "must not be empty", hint: "fix the value at this path" }])
  assert.equal(errorsUnder(errors, ["slides", 0]).length, 0)
  assert.equal(errorsUnder(errors, []).length, 3)
  // slides[1] must not also match slides[10]
  assert.equal(errorsUnder([{ path: "content.slides[10].title", message: "x" }], ["slides", 1]).length, 0)
})

test("convertType keeps what both types share and maps the obvious aliases", () => {
  const title = { type: "title", title: "Plan", subtitle: "For Acme", notes: "say hello", build: false }
  const bullets = convertType(title, ITEM_TEMPLATES.deck.bullets, ["type", "title", "bullets", "notes", "build"])
  assert.equal(bullets.type, "bullets")
  assert.equal(bullets.title, "Plan")
  assert.equal(bullets.notes, "say hello")
  assert.equal(bullets.build, false)
  assert.ok(Array.isArray(bullets.bullets) && bullets.bullets.length > 0, "the new type's required list comes from its template")
  assert.ok(!("subtitle" in bullets), "a field the new type does not have is dropped, or the API would reject it")

  const quote = convertType({ type: "quote", quote: "Ship it.", author: "Fady" }, ITEM_TEMPLATES.deck.title, ["type", "title", "subtitle", "eyebrow", "icon", "notes", "build"])
  assert.equal(quote.title, "Ship it.", "quote → title")

  const hero = convertType({ type: "cta", heading: "Ready?", cta_label: "Go" }, ITEM_TEMPLATES.page.hero, ["type", "eyebrow", "heading", "body", "cta_label", "cta_href", "scene", "visual"])
  assert.equal(hero.heading, "Ready?")
  assert.equal(hero.cta_label, "Go")
})

test("history: typing in one field folds into one step; undo and redo walk the content", () => {
  let h = historyOf({ v: "" })
  h = record(h, { v: "a" }, "set:title", 1000)
  h = record(h, { v: "ab" }, "set:title", 1200)
  h = record(h, { v: "abc" }, "set:title", 1400)
  assert.equal(h.past.length, 1, "three keystrokes, one undo step")
  h = record(h, { v: "abc", w: 1 } as { v: string }, "set:other", 1500)
  assert.equal(h.past.length, 2)
  h = record(h, { v: "abcd" }, "set:title", 9000)
  assert.equal(h.past.length, 3, "after a pause the same field starts a new step")
  h = undo(h)
  assert.deepEqual(h.present, { v: "abc", w: 1 })
  h = undo(undo(h))
  assert.deepEqual(h.present, { v: "" })
  assert.equal(undo(h), h, "nothing left to undo")
  h = redo(h)
  assert.deepEqual(h.present, { v: "abc" })
  h = record(h, { v: "x" }, "", 20000)
  assert.equal(h.future.length, 0, "a new change drops the redo stack")
})

test("templates come in the document's language, and data fields are never translated", () => {
  const ar = localized(ITEM_TEMPLATES.deck.bullets, "ar") as { type: string; title: string; bullets: string[] }
  assert.equal(ar.type, "bullets")
  assert.notEqual(ar.title, "Key points")
  assert.ok(/[؀-ۿ]/.test(ar.title))
  const wf = localized(ITEM_TEMPLATES.deck.workflow, "ar") as { steps: { id: string; icon: string; kind?: string; title: string }[] }
  assert.deepEqual(wf.steps.map((s) => s.id), ["request", "check", "done"], "ids, icons and kinds stay")
  assert.equal(wf.steps[1].kind, "decision")
  const en = localized(ITEM_TEMPLATES.deck.bullets, "en")
  assert.deepEqual(en, ITEM_TEMPLATES.deck.bullets)
  assert.notEqual(en, ITEM_TEMPLATES.deck.bullets, "a copy: editing a new slide must not edit the template")
  // The hero template carries `title: undefined` in its visual; a localized copy must be plain JSON.
  assert.ok(!("title" in (localized(ITEM_TEMPLATES.page.hero, "ar") as { visual: object }).visual))
})
