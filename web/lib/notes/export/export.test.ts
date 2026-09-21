import assert from "node:assert/strict"
import { before, describe, test } from "node:test"

import { JSDOM } from "jsdom"

import { markdownToTxt } from "./txt.ts"

/*
Exports leave the app, so a defect here produces a broken file on someone's
disk rather than a visible glitch. The HTML exporter renders through the shared
pipeline, which needs a DOM for DOMPurify — hence the dynamic import, as in
lib/markdown/renderer.test.ts.
*/

let noteToHtml: typeof import("./html.ts").noteToHtml

before(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  const g = globalThis as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.Node = dom.window.Node
  g.DocumentFragment = dom.window.DocumentFragment
  g.HTMLTemplateElement = dom.window.HTMLTemplateElement
  ;({ noteToHtml } = await import("./html.ts"))
})

const SAMPLE = `# Title

Some **bold** and \`code\`.

- one
- two

| a | b |
| --- | --- |
| 1 | 2 |

\`\`\`go
func main() {}
\`\`\`
`

describe("plain text export", () => {
  test("keeps headings and list content, drops inline markup", () => {
    const txt = markdownToTxt(SAMPLE)
    assert.match(txt, /Title/)
    assert.match(txt, /one/)
    assert.doesNotMatch(txt, /\*\*bold\*\*/)
    assert.match(txt, /bold/)
  })

  test("ends with exactly one trailing newline", () => {
    const txt = markdownToTxt(SAMPLE)
    assert.ok(txt.endsWith("\n"))
    assert.ok(!txt.endsWith("\n\n"))
  })

  test("empty input does not throw", () => {
    assert.equal(typeof markdownToTxt(""), "string")
  })
})

describe("HTML export", () => {
  test("is a complete standalone document", () => {
    const html = noteToHtml(SAMPLE, { title: "My note" })
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /<title>My note<\/title>/)
    assert.match(html, /<\/html>\s*$/)
  })

  test("inlines all styling — nothing is fetched", () => {
    const html = noteToHtml(SAMPLE, { title: "t" })
    assert.match(html, /<style>/)
    // A file that links a stylesheet or a font is not self-contained.
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i)
    assert.doesNotMatch(html, /<script/i)
    assert.doesNotMatch(html, /fonts\.googleapis/i)
  })

  test("renders the note body through the shared pipeline", () => {
    const html = noteToHtml(SAMPLE, { title: "t" })
    assert.match(html, /<strong>bold<\/strong>/)
    assert.match(html, /<table>/)
    assert.match(html, /hljs/)
  })

  test("the title is escaped, so it cannot inject", () => {
    const html = noteToHtml("body", { title: '</title><script>alert(1)</script>' })
    assert.doesNotMatch(html, /<script/i)
  })

  test("body content is still sanitised on the way out", () => {
    const html = noteToHtml('<img src=x onerror="alert(1)">', { title: "t" })
    assert.doesNotMatch(html, /onerror/i)
  })

  test("a reading theme is baked into the exported file", () => {
    const plain = noteToHtml(SAMPLE, { title: "t" })
    const dracula = noteToHtml(SAMPLE, { title: "t", theme: "dracula" })
    assert.notEqual(plain, dracula)
    // The neutral default must not leak into a themed export.
    assert.doesNotMatch(dracula.slice(0, dracula.indexOf("</style>")), /#ffffff;/)
  })

  test("an unknown theme falls back rather than emitting undefined", () => {
    const html = noteToHtml(SAMPLE, { title: "t", theme: "no-such-theme" })
    assert.doesNotMatch(html, /undefined/)
  })

  test("interactive chrome is hidden — it is meaningless in a static file", () => {
    const html = noteToHtml(SAMPLE, { title: "t" })
    assert.match(html, /\.zk-code-menu[^{]*\{display:none\}/)
  })

  test("direction can be set for an RTL note", () => {
    assert.match(noteToHtml("مرحبا", { title: "t", dir: "rtl" }), /<html lang="en" dir="rtl">/)
  })
})

describe("Word export", () => {
  test("produces a real .docx (zip container, non-trivial size)", async () => {
    const { markdownToDocx } = await import("./docx.ts")
    const buf = await markdownToDocx(SAMPLE)
    // A .docx is an OPC zip: it must start with the PK local-file header.
    assert.equal(buf[0], 0x50, "missing PK magic — not a zip")
    assert.equal(buf[1], 0x4b)
    assert.ok(buf.length > 2000, `suspiciously small: ${buf.length} bytes`)
  })

  test("empty input still yields a valid document rather than throwing", async () => {
    const { markdownToDocx } = await import("./docx.ts")
    const buf = await markdownToDocx("")
    assert.equal(buf[0], 0x50)
  })
})
