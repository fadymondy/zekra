import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
// TipTap 3 ships TableKit, which bundles Table + Row + Header + Cell. The
// bare extension-table entry point has no default export in v3, so importing
// the pieces individually is both noisier and a version trap.
import { TableKit } from "@tiptap/extension-table"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"

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
  ]
}
