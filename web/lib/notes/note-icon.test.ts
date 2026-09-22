import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { isCuratedCategory, noteIcon } from "./note-icon.ts"

/*
The mapping is data, so the tests are about its edges: that it always returns
something usable, that casing and pluralisation do not fracture it, and that
unknown categories still get distinct colours rather than all collapsing to one.
*/

describe("always returns something renderable", () => {
  test("empty, null and undefined fall back to the note icon", () => {
    for (const input of ["", null, undefined, "   "]) {
      const got = noteIcon(input)
      assert.ok(got.Icon, `no icon for ${JSON.stringify(input)}`)
      assert.ok(got.color, `no colour for ${JSON.stringify(input)}`)
    }
    assert.equal(noteIcon("").color, noteIcon("note").color)
  })

  test("an unknown category still gets an icon and a colour", () => {
    const got = noteIcon("wildly-unexpected-type")
    assert.ok(got.Icon)
    assert.match(got.color, /oklch|var\(|#/)
  })
})

describe("normalisation", () => {
  test("casing does not matter", () => {
    assert.equal(noteIcon("Venture").Icon, noteIcon("venture").Icon)
    assert.equal(noteIcon("VENTURE").color, noteIcon("venture").color)
  })

  test("surrounding whitespace does not matter", () => {
    assert.equal(noteIcon("  issue  ").Icon, noteIcon("issue").Icon)
  })

  // Two icons for "issue" and "issues" reads as a bug, not a distinction.
  test("a plural resolves to its curated singular", () => {
    assert.equal(noteIcon("issues").Icon, noteIcon("issue").Icon)
    assert.equal(noteIcon("ventures").color, noteIcon("venture").color)
    assert.equal(isCuratedCategory("people"), true)
  })

  test("a word merely ending in s is not mangled", () => {
    // "status" must not be de-pluralised into "statu".
    assert.equal(isCuratedCategory("status"), false)
    assert.ok(noteIcon("status").Icon)
  })
})

describe("curated vs derived", () => {
  test("the common entity types are curated", () => {
    for (const c of ["note", "venture", "person", "agent", "issue", "task", "goal", "learning", "decision"]) {
      assert.equal(isCuratedCategory(c), true, `${c} is not curated`)
    }
  })

  test("curated colours are literal values, not hashed", () => {
    assert.match(noteIcon("venture").color, /^#|^var\(/)
  })

  test("distinct unknown categories keep distinct colours", () => {
    // If uncurated types all collapsed to one colour the list would lose the
    // only signal it has for them.
    assert.notEqual(noteIcon("alpha-type").color, noteIcon("beta-type").color)
  })

  test("the same unknown category is stable across calls", () => {
    assert.equal(noteIcon("some-type").color, noteIcon("some-type").color)
  })

  test("different curated types do not share an icon by accident", () => {
    const venture = noteIcon("venture").Icon
    const person = noteIcon("person").Icon
    assert.notEqual(venture, person)
  })
})
