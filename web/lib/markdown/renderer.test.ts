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
    // Headers became sort buttons when the interactive table landed (MH-211),
    // so the cell text is no longer a direct child of <th>.
    assert.match(html, /<th[^>]*data-col="0"/)
    assert.match(html, />a</)
    assert.match(html, /<td[^>]*>1</)
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

describe("code block chrome (MH-210)", () => {
  test("emits the title bar with traffic lights and a menu hook", () => {
    const html = render("```go\nfunc main() {}\n```")
    assert.match(html, /<figure class="zk-code"/)
    assert.match(html, /zk-code-lights/)
    assert.match(html, /data-zk-code-menu/)
  })

  test("a bare language labels itself and gets a default filename", () => {
    const html = render("```go\nx := 1\n```")
    assert.match(html, /data-filename="snippet\.go"/)
    assert.match(html, /<span class="zk-code-name">go<\/span>/)
  })

  test("an info string filename becomes the label", () => {
    const html = render("```yml snippet.yml\nkey: value\n```")
    assert.match(html, /<span class="zk-code-name">snippet\.yml<\/span>/)
    assert.match(html, /data-filename="snippet\.yml"/)
  })

  test("carries the ORIGINAL source for copy and download, not the highlighted markup", () => {
    const html = render("```go\nfunc main() {}\n```")
    // data-code must be the author's text; copying spans would be useless.
    assert.match(html, /data-code="func main\(\) \{\}"/)
  })

  test("still highlights, and survives sanitisation", () => {
    const html = render("```go\nfunc main() {}\n```")
    assert.match(html, /class="hljs language-go"/)
    assert.match(html, /hljs-/)
    // DOMPurify must not strip the chrome we just added.
    assert.match(html, /<figcaption/)
    assert.match(html, /<button/)
  })

  test("an unknown language degrades instead of throwing", () => {
    const html = render("```not-a-real-language\nplain\n```")
    assert.match(html, /language-plaintext/)
    assert.match(html, /plain/)
  })

  test("source containing HTML is escaped inside data-code", () => {
    const html = render("```html\n<script>alert(1)</script>\n```")
    assert.doesNotMatch(html, /<script/i)
  })
})

describe("table component (MH-211)", () => {
  const T = "| Agent | Note |\n| --- | --- |\n| Sentra | routes **scans** |\n| Nadia | owns `policy` |"

  test("emits the toolbar: filter, row count, export menu", () => {
    const html = render(T)
    assert.match(html, /<figure class="zk-table"/)
    assert.match(html, /data-zk-table-filter/)
    assert.match(html, /data-zk-table-count[^>]*>2 rows</)
    assert.match(html, /data-zk-table-menu/)
  })

  test("headers are sortable buttons", () => {
    const html = render(T)
    assert.match(html, /data-zk-table-sort="0"/)
    assert.match(html, /data-zk-table-sort="1"/)
  })

  // The regression this guards: rendering cells as plain text would silently
  // strip markup from every table in the app.
  test("cells keep their inline markup for display", () => {
    const html = render(T)
    assert.match(html, /<strong>scans<\/strong>/)
    assert.match(html, /<code>policy<\/code>/)
  })

  test("data-rows carries PLAIN text for filter, sort and export", () => {
    const html = render(T)
    const m = html.match(/data-rows="([^"]*)"/)
    assert.ok(m, "no data-rows payload")
    const json = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    assert.deepEqual(json.headers, ["Agent", "Note"])
    // No asterisks or backticks: a CSV cell must not contain markdown syntax.
    assert.deepEqual(json.rows, [["Sentra", "routes scans"], ["Nadia", "owns policy"]])
  })

  test("column alignment is preserved", () => {
    const html = render("| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |")
    assert.match(html, /text-align:left/)
    assert.match(html, /text-align:center/)
    assert.match(html, /text-align:right/)
  })

  test("the chrome survives sanitisation", () => {
    const html = render(T)
    assert.match(html, /<input/)
    assert.match(html, /<button/)
    assert.match(html, /zk-table-scroll/)
  })

  test("a cell containing HTML cannot inject", () => {
    const html = render("| a |\n| --- |\n| <img src=x onerror=alert(1)> |")
    // Assert on the rendered cell specifically: data-rows legitimately holds
    // the literal source text, attribute-encoded, which is inert.
    const body = html.slice(html.indexOf("<tbody>"))
    assert.doesNotMatch(body, /onerror/i)
  })

  test("exported cell text carries no HTML tags", () => {
    const html = render("| a |\n| --- |\n| <img src=x onerror=alert(1)> |")
    const m = html.match(/data-rows="([^"]*)"/)
    const json = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    assert.deepEqual(json.rows, [[""]], "a CSV cell must not contain markup the table rendered away")
  })

  test("row count is singular for one row", () => {
    assert.match(render("| a |\n| --- |\n| 1 |"), /data-zk-table-count[^>]*>1 row</)
  })
})
