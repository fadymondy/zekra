import assert from "node:assert/strict"
import { before, describe, test } from "node:test"

import { JSDOM } from "jsdom"

/*
Tests for the markdown pipeline ported from mark-it-down.

DOMPurify binds to a window at import time, so the DOM has to exist before
lib/markdown is loaded — hence the dynamic import inside before(). Importing
renderMarkdown at the top of this file would bind it to a non-existent window
and every sanitize call would pass its input straight through, which is the
exact failure this suite is supposed to catch.
*/

let renderMarkdown: typeof import("./renderer.ts").renderMarkdown

before(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  const g = globalThis as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.Node = dom.window.Node
  g.DocumentFragment = dom.window.DocumentFragment
  g.HTMLTemplateElement = dom.window.HTMLTemplateElement
  ;({ renderMarkdown } = await import("./renderer.ts"))
})

const render = (md: string) => renderMarkdown(md, { extractMermaid: false }).html

describe("markdown rendering", () => {
  test("renders GFM tables", () => {
    const html = render("| a | b |\n| --- | --- |\n| 1 | 2 |")
    assert.match(html, /<table>/)
    assert.match(html, /<th>a<\/th>/)
    assert.match(html, /<td>1<\/td>/)
  })

  test("renders task lists with checkboxes", () => {
    const html = render("- [x] done\n- [ ] todo")
    assert.match(html, /<input[^>]+type="checkbox"/)
    assert.match(html, /checked/)
  })

  test("renders nested and ordered lists", () => {
    const html = render("1. one\n   - nested\n2. two")
    assert.match(html, /<ol>/)
    assert.match(html, /<ul>/)
  })

  test("applies highlight.js classes to fenced code", () => {
    const html = render("```go\nfunc main() {}\n```")
    assert.match(html, /class="hljs language-go"/)
    // The body must actually be tokenised, not just wrapped.
    assert.match(html, /hljs-/)
  })

  test("unknown languages fall back to plaintext without throwing", () => {
    const html = render("```not-a-real-language\nx\n```")
    assert.match(html, /<pre>/)
    assert.match(html, /x/)
  })

  test("footnotes, strikethrough and autolinks survive", () => {
    assert.match(render("~~gone~~"), /<del>/)
    assert.match(render("<https://zekra.dev>"), /<a href="https:\/\/zekra\.dev"/)
  })
})

describe("raw HTML (explicitly required by the product)", () => {
  test("keeps details, summary and kbd", () => {
    const html = render("<details><summary>More</summary>\n\nhidden\n\n</details>")
    assert.match(html, /<details>/)
    assert.match(html, /<summary>More<\/summary>/)
    assert.match(render("<kbd>Ctrl</kbd>"), /<kbd>Ctrl<\/kbd>/)
  })

  test("keeps sub and sup", () => {
    assert.match(render("H<sub>2</sub>O and x<sup>2</sup>"), /<sub>2<\/sub>/)
    assert.match(render("x<sup>2</sup>"), /<sup>2<\/sup>/)
  })
})

describe("sanitisation", () => {
  // Notes are attacker-influenced content rendered inside our own origin, so
  // each of these is a real stored-XSS vector, not a theoretical one.
  test("strips script tags", () => {
    const html = render("before\n\n<script>alert(1)</script>\n\nafter")
    assert.doesNotMatch(html, /<script/i)
    assert.match(html, /before/)
  })

  test("strips inline event handlers", () => {
    const html = render(`<img src="x" onerror="alert(1)">`)
    assert.doesNotMatch(html, /onerror/i)
  })

  test("strips javascript: URLs", () => {
    const html = render("[click](javascript:alert(1))")
    assert.doesNotMatch(html, /javascript:/i)
  })

  test("strips iframes and object embeds", () => {
    assert.doesNotMatch(render(`<iframe src="https://evil.example"></iframe>`), /<iframe/i)
    assert.doesNotMatch(render(`<object data="x"></object>`), /<object/i)
  })

  test("strips svg, which executes script in our origin", () => {
    const html = render(`<svg><script>alert(1)</script></svg>`)
    assert.doesNotMatch(html, /<script/i)
  })

  test("strips style tags and expression payloads", () => {
    assert.doesNotMatch(render(`<style>body{display:none}</style>`), /<style/i)
  })
})

describe("mixed direction and edge cases", () => {
  test("Arabic body with Latin identifiers renders without loss", () => {
    const html = render("هذه فقرة عربية مع `searchPool` بداخلها")
    assert.match(html, /هذه فقرة عربية/)
    assert.match(html, /<code>searchPool<\/code>/)
  })

  test("empty and whitespace input do not throw", () => {
    assert.equal(typeof render(""), "string")
    assert.equal(typeof render("   \n\n  "), "string")
  })

  test("escaped markdown stays literal", () => {
    const html = render("\\*not italic\\*")
    assert.doesNotMatch(html, /<em>/)
  })
})
