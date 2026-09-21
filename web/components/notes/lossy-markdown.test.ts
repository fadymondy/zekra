import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { findLossyConstructs, isLossy } from "./lossy-markdown.ts"

/*
A false negative here loses a user's content, so these tests lean on the cases
where the check could plausibly miss something.
*/

describe("detects constructs the editor cannot round-trip", () => {
  test("footnote definitions", () => {
    const found = findLossyConstructs("A claim.[^1]\n\n[^1]: The note.")
    assert.equal(found.length, 1)
    assert.equal(found[0].kind, "footnote")
  })

  test("details blocks", () => {
    assert.ok(isLossy("<details><summary>x</summary>\n\nbody\n\n</details>"))
  })

  test("raw HTML tables and iframes", () => {
    assert.ok(isLossy("<table><tr><td>1</td></tr></table>"))
    assert.ok(isLossy('<iframe src="https://example.com"></iframe>'))
  })

  test("indented HTML is still caught", () => {
    assert.ok(isLossy("  <div>indented</div>"))
  })

  test("reports both when a note has both", () => {
    const found = findLossyConstructs("<details>x</details>\n\n[^a]: note")
    assert.equal(found.length, 2)
    assert.deepEqual(found.map((f) => f.kind).sort(), ["footnote", "html-block"])
  })
})

describe("does not cry wolf", () => {
  // The important false-positive case: a note ABOUT html must stay editable.
  test("HTML inside a fenced code block is an example, not a construct", () => {
    assert.equal(isLossy("```html\n<details><summary>x</summary></details>\n```"), false)
  })

  test("HTML inside an indented code block is an example too", () => {
    assert.equal(isLossy("    <div>example</div>"), false)
  })

  test("a footnote reference without a definition is just text", () => {
    assert.equal(isLossy("See the note[^1] for detail."), false)
  })

  test("inline HTML round-trips, so it is not flagged", () => {
    assert.equal(isLossy("Press <kbd>Ctrl</kbd> and H<sub>2</sub>O"), false)
  })

  test("ordinary markdown is clean", () => {
    assert.equal(isLossy("# Title\n\n- a\n- b\n\n| x | y |\n| --- | --- |\n| 1 | 2 |"), false)
  })

  test("empty input is clean", () => {
    assert.equal(isLossy(""), false)
    assert.equal(isLossy(undefined as unknown as string), false)
  })

  test("a link that looks like a footnote is not one", () => {
    assert.equal(isLossy("[label]: https://example.com"), false)
  })
})
