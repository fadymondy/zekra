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

describe("per-note overrides (MH-308)", () => {
  test("an icon override wins over the category", () => {
    const derived = noteIcon({ category: "venture" })
    const overridden = noteIcon({ category: "venture", icon: "Bug" })
    assert.notEqual(overridden.Icon, derived.Icon)
    assert.equal(overridden.Icon, noteIcon({ category: "issue" }).Icon)
  })

  test("a colour override wins over the category", () => {
    assert.equal(noteIcon({ category: "venture", color: "#6d4de6" }).color, "#6d4de6")
  })

  // The server stores "" for "no override"; treating that as a choice would
  // leave a cleared note with no icon at all.
  test("an empty override falls back to derived, not to blank", () => {
    const derived = noteIcon({ category: "venture" })
    const cleared = noteIcon({ category: "venture", icon: "", color: "" })
    assert.equal(cleared.Icon, derived.Icon)
    assert.equal(cleared.color, derived.color)
  })

  test("whitespace is not a choice either", () => {
    assert.equal(noteIcon({ category: "venture", icon: "   " }).Icon, noteIcon({ category: "venture" }).Icon)
  })

  // A note written by a newer client, or via the API, can carry a name this
  // build cannot render.
  test("an unknown icon override degrades to the derived icon", () => {
    const got = noteIcon({ category: "venture", icon: "SomeFutureIcon" })
    assert.equal(got.Icon, noteIcon({ category: "venture" }).Icon)
  })

  test("icon and colour override independently", () => {
    const got = noteIcon({ category: "venture", color: "#4e9a3e" })
    assert.equal(got.Icon, noteIcon({ category: "venture" }).Icon, "icon should still derive")
    assert.equal(got.color, "#4e9a3e")
  })

  test("a bare category string still works, so old call sites are unaffected", () => {
    assert.equal(noteIcon("venture").Icon, noteIcon({ category: "venture" }).Icon)
    assert.ok(noteIcon(null).Icon)
  })
})
