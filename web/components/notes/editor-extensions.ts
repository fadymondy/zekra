import { Extension } from "@tiptap/core"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
// TipTap 3 ships TableKit, which bundles Table + Row + Header + Cell. The
// bare extension-table entry point has no default export in v3, so importing
// the pieces individually is both noisier and a version trap.
import { TableKit } from "@tiptap/extension-table"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { Node as PmNode } from "@tiptap/pm/model"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"

/*
Per-block text direction: every block reads in the direction of its OWN text,
so an English paragraph in an Arabic note (or UI) starts at the left with its
punctuation where it belongs, and an Arabic one starts at the right.

Done with node DECORATIONS (dir="auto" on the rendered element), not with a
schema attribute (addGlobalAttributes): an attribute would be part of the
document, and tiptap-markdown's HTML fallback (a table it cannot write as a
pipe table, a raw HTML block) would then serialise `dir="auto"` into the
author's markdown. Decorations exist only in the view — nothing reaches the
saved note. Lists and tables get it too, so a list's markers and a table's
column order follow its content; code blocks stay left-to-right.
*/
const AUTO_DIR_BLOCKS = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table",
  "tableCell",
  "tableHeader",
])

function directionDecorations(doc: PmNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === "codeBlock") {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: "ltr" }))
      return false
    }
    if (AUTO_DIR_BLOCKS.has(name)) decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: "auto" }))
    // Inline content has no blocks below it.
    return !node.isTextblock
  })
  return DecorationSet.create(doc, decos)
}

export const BlockDirection = Extension.create({
  name: "blockDirection",
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>("blockDirection")
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => directionDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? directionDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ]
  },
})

/*
The editor schema, shared by the component and the round-trip test — so the
test proves what the editor actually does, not a lookalike configuration.

Every extension beyond StarterKit is here because the round-trip test showed
markdown being LOST without it. A construct with no node in the schema is
silently dropped on save, which would rewrite the author's note. See
markdown-roundtrip.test.ts for the constructs that still degrade.
*/
export function editorExtensions() {
  return [
    StarterKit.configure({ codeBlock: { HTMLAttributes: { class: "hljs" } } }),
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({ openOnClick: false, autolink: true }),
    // Tables: without these, "| a | b |" collapses to loose paragraphs.
    TableKit.configure({ table: { resizable: false } }),
    // Task lists: without these, "- [x] done" loses its checkbox.
    TaskList,
    TaskItem.configure({ nested: true }),
    // html: true keeps raw HTML as-is where the schema cannot model it, which
    // is better than dropping it outright.
    Markdown.configure({ html: true, linkify: false, breaks: false, transformPastedText: true }),
    // View-only: never part of the document, so never in the markdown.
    BlockDirection,
  ]
}
