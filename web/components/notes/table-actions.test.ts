import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { compare, csvCell, toMarkdown } from "./table-export.ts"

/*
The pure half of the table behaviour. The DOM half (delegated listeners, menu
placement) is left to manual checking; these are the parts where a quiet bug
would corrupt exported data rather than merely look wrong.
*/

describe("table sorting", () => {
  test("numbers sort numerically, not lexically", () => {
    const got = ["10", "2", "1"].sort(compare)
    // The classic failure: lexical order gives 1, 10, 2.
    assert.deepEqual(got, ["1", "2", "10"])
  })

  test("thousands separators do not break numeric sort", () => {
    assert.deepEqual(["1,200", "300"].sort(compare), ["300", "1,200"])
  })

  test("mixed numeric and text does not silently misorder", () => {
    // "n/a" is not numeric, so the pair falls back to a locale compare rather
    // than NaN-comparing (which returns 0 and leaves order undefined).
    const got = ["n/a", "5"].sort(compare)
    assert.equal(got.length, 2)
    assert.notEqual(compare("n/a", "5"), 0)
  })

  test("empty cells are not treated as zero", () => {
    // Number("") is 0; without the emptiness guard an empty cell would sort
    // among the numbers instead of as text.
    assert.notEqual(compare("", "0"), 0)
  })

  test("text sorts case-insensitively", () => {
    assert.deepEqual(["beta", "Alpha"].sort(compare), ["Alpha", "beta"])
  })
})

describe("CSV export (RFC 4180)", () => {
  test("plain values are unquoted", () => {
    assert.equal(csvCell("Sentra"), "Sentra")
  })

  test("commas force quoting", () => {
    assert.equal(csvCell("a,b"), '"a,b"')
  })

  test("quotes are doubled and the cell quoted", () => {
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  })

  test("newlines force quoting", () => {
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"')
  })
})

describe("Copy as Markdown", () => {
  test("round-trips a simple table", () => {
    const md = toMarkdown({ headers: ["a", "b"], rows: [["1", "2"]] })
    assert.equal(md, "| a | b |\n| --- | --- |\n| 1 | 2 |")
  })

  test("pipes in cells are escaped so the table does not break", () => {
    const md = toMarkdown({ headers: ["h"], rows: [["x | y"]] })
    assert.match(md, /x \\\| y/)
  })

  test("an empty table still emits a valid header and separator", () => {
    const md = toMarkdown({ headers: ["only"], rows: [] })
    assert.equal(md, "| only |\n| --- |")
  })
})
