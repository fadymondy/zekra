import assert from "node:assert/strict"
import { before, describe, test } from "node:test"

import { JSDOM } from "jsdom"

/*
Does markdown survive a trip through the editor?

markdown -> TipTap document -> markdown is lossy for any construct the schema
has no node for. That is not a cosmetic problem: opening a note in the editor
and saving it would silently rewrite the author's content. This suite exists to
find out exactly WHICH constructs are affected before anyone edits a real note.

Where a construct is genuinely unsupported the test records the actual
behaviour rather than asserting the ideal, so the loss is documented instead of
discovered later by a user.
*/

let roundTrip: (md: string) => string

before(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
  const g = globalThis as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  // Node 24 defines globalThis.navigator as a getter-only property, so a plain
  // assignment throws; ProseMirror reads it for platform detection.
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  })
  g.Node = dom.window.Node
  g.Element = dom.window.Element
  g.HTMLElement = dom.window.HTMLElement
  g.DocumentFragment = dom.window.DocumentFragment
  g.HTMLTemplateElement = dom.window.HTMLTemplateElement
  g.DOMParser = dom.window.DOMParser
  g.MutationObserver = dom.window.MutationObserver
  g.getComputedStyle = dom.window.getComputedStyle

  const { Editor } = await import("@tiptap/core")
  const { editorExtensions } = await import("./editor-extensions.ts")

  roundTrip = (md: string) => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content: md,
    })
    const out = editor.storage.markdown.getMarkdown() as string
    editor.destroy()
    return out
  }
})

describe("per-block direction (view only)", () => {
  test("blocks render dir=auto, code blocks ltr, and no dir reaches the markdown", async () => {
    const { Editor } = await import("@tiptap/core")
    const { editorExtensions } = await import("./editor-extensions.ts")
    const element = document.createElement("div")
    document.body.appendChild(element)
    const md = "BUILD LEDGER.\n\nمرحبا بالعالم.\n\n- one\n- two\n\n```\ncode\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"
    const editor = new Editor({ element, extensions: editorExtensions(), content: md })
    const dom = editor.view.dom
    assert.equal(dom.querySelector("p")?.getAttribute("dir"), "auto")
    assert.equal(dom.querySelector("li")?.getAttribute("dir"), "auto")
    assert.equal(dom.querySelector("ul")?.getAttribute("dir"), "auto")
    assert.equal(dom.querySelector("pre")?.getAttribute("dir"), "ltr")
    assert.equal(dom.querySelector("td, th")?.getAttribute("dir"), "auto")
    // Typing keeps them in step.
    editor.commands.insertContentAt(editor.state.doc.content.size, "<p>more</p>")
    assert.ok([...dom.querySelectorAll("p")].every((p) => p.getAttribute("dir") === "auto"))
    const out = editor.storage.markdown.getMarkdown() as string
    assert.doesNotMatch(out, /dir=/)
    assert.match(out, /BUILD LEDGER\./)
    editor.destroy()
    element.remove()
  })
})

/** Ignore whitespace and escaping noise the serializer legitimately normalises. */
const norm = (s: string) => s.replace(/\\/g, "").replace(/\s+/g, " ").trim()

describe("constructs that must survive editing", () => {
  test("headings", () => {
    assert.match(roundTrip("# One\n\n## Two"), /# One/)
    assert.match(roundTrip("# One\n\n## Two"), /## Two/)
  })

  test("inline emphasis and code", () => {
    const out = norm(roundTrip("**bold** and *italic* and `code`"))
    assert.match(out, /\*\*bold\*\*/)
    assert.match(out, /`code`/)
  })

  test("links keep their target", () => {
    assert.match(roundTrip("[Zekra](https://zekra.dev)"), /\(https:\/\/zekra\.dev\)/)
  })

  test("images keep their src", () => {
    assert.match(roundTrip("![alt](/api/notes/image/ns/abc123def456.png)"), /abc123def456\.png/)
  })

  test("nested lists keep their nesting", () => {
    const out = roundTrip("- one\n  - nested\n- two")
    assert.match(out, /one/)
    assert.match(out, /nested/)
    assert.match(out, /two/)
  })

  test("ordered lists stay ordered", () => {
    assert.match(roundTrip("1. first\n2. second"), /1\./)
  })

  test("fenced code keeps its language and body verbatim", () => {
    const out = roundTrip("```go\nfunc main() {}\n```")
    assert.match(out, /```go/)
    assert.match(out, /func main\(\) \{\}/)
  })

  test("blockquotes survive", () => {
    assert.match(roundTrip("> quoted"), /> quoted/)
  })

  test("horizontal rules survive", () => {
    assert.match(roundTrip("a\n\n---\n\nb"), /---/)
  })

  test("Arabic text is not mangled", () => {
    assert.match(roundTrip("هذه فقرة عربية"), /هذه فقرة عربية/)
  })

  test("a plain paragraph is byte-stable across two trips", () => {
    // Instability here would mean every open-and-save rewrites the note.
    const once = roundTrip("Just a sentence.")
    assert.equal(roundTrip(once), once)
  })
})

describe("constructs recovered by adding schema nodes", () => {
  // These were lost under bare StarterKit. The extensions in
  // editor-extensions.ts exist specifically because of these failures.
  test("GFM tables survive", () => {
    const out = roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |")
    assert.match(out, /\|/)
    assert.match(out, /a/)
    assert.match(out, /1/)
  })

  test("task list checkboxes survive", () => {
    const out = roundTrip("- [x] done\n- [ ] todo")
    assert.match(out, /\[x\]/i)
    assert.match(out, /done/)
  })

  test("strikethrough survives", () => {
    assert.match(roundTrip("~~gone~~"), /~~gone~~/)
  })
})

/*
Losses that REMAIN. These assert current behaviour so the gap is explicit and
a future fix trips a failing test rather than going unnoticed. Both appear in
the kitchen-sink fixture note, which is why the editor must not be pointed at
arbitrary notes without the guard in note-editor-wysiwyg.
*/
describe("remaining losses — the editor refuses these notes", () => {
  test("footnote definitions are dropped", () => {
    const out = roundTrip("A claim.[^1]\n\n[^1]: The note.")
    assert.doesNotMatch(out, /\[\^1\]:/)
  })

  test("raw HTML blocks do not round-trip intact", () => {
    const out = roundTrip("<details><summary>More</summary>\n\nhidden\n\n</details>")
    assert.doesNotMatch(out, /<summary>/)
  })
})
