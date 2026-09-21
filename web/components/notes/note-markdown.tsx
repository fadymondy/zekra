"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { renderMarkdown } from "@/lib/markdown"
import type { NoteRef } from "@/lib/markdown/wikilinks/resolver"
import { NOTE_THEME_ATTR } from "@/lib/markdown/themes/apply"
import { useCodeActions } from "./code-actions"
import { useTableActions } from "./table-actions"
import { NoteThemeStyle, useNoteTheme } from "./theme-picker"

/*
A note body, rendered through the markdown pipeline ported from mark-it-down
(lib/markdown): marked + marked-highlight (highlight.js) -> DOMPurify.

Why this is not react-markdown any more: notes must render RAW HTML — <details>,
<kbd>, <sub>, inline tables — which react-markdown drops by default and which
only comes back via rehype-raw plus a hand-rolled sanitizer. The ported pipeline
already parses HTML and already sanitizes it, and it is the same code the
VSCode webview and the Electron renderer use, so the three surfaces cannot
drift in what they accept.

SSR: DOMPurify needs a DOM. Sanitizing on the server would mean either pulling
in jsdom or — far worse — quietly skipping the sanitize step and shipping
unsanitized HTML. So the render happens on the client only, after mount. Note
bodies are private and never indexed, so there is nothing to lose to SEO; the
cost is one frame showing the fallback below.
*/

export function NoteMarkdown({ text, notes }: { text: string; notes?: NoteRef[] }) {
  // Gate on mount rather than `typeof window`, so the server and the first
  // client render agree and React does not report a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Code-block actions are delegated from this container (see code-actions).
  const bodyRef = useRef<HTMLDivElement>(null)
  const codeMenu = useCodeActions(bodyRef)
  const tableMenu = useTableActions(bodyRef)
  const { id: themeId } = useNoteTheme()

  const html = useMemo(() => {
    if (!mounted) return ""
    // Mermaid is left as a plain fenced block for now: no mermaid runtime is
    // bundled, and emitting empty placeholder divs would render nothing at all
    // — a worse outcome than showing the diagram source.
    return renderMarkdown(text ?? "", { extractMermaid: false, notes }).html
  }, [text, notes, mounted])

  if (!mounted) {
    // Pre-mount fallback: the source, wrapped, never raw HTML.
    return (
      <div dir="auto" className={`${PROSE} whitespace-pre-wrap font-mono text-xs text-grid-muted`}>
        {text}
      </div>
    )
  }

  return (
    <>
      <NoteThemeStyle id={themeId} />
      <div
        ref={bodyRef}
        dir="auto"
        // The reading theme is scoped to this element, never the app chrome.
        {...(themeId ? { [NOTE_THEME_ATTR]: themeId } : {})}
        className={PROSE}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {codeMenu}
      {tableMenu}
    </>
  )
}

/*
GitHub-flavoured presentation on the grid tokens. Kept as utility classes
rather than the typography plugin so the palette stays ours and a theme change
(the 27 ported themes) only has to move CSS variables.

Deliberate choices:
  - lists are list-outside with ps-5 and li ps-1: the browser already indents
    <ol>/<ul>, so an extra margin on <li> double-indents. That exact bug was
    reported and fixed once already; do not reintroduce it.
  - no max-width here. A reading-width cap was explicitly removed on request
    ("make the markdown full width"); the Typography setting will reintroduce
    it as an opt-in, not a default.
  - pre is overflow-x-auto so a long line scrolls inside the block instead of
    widening the page.
*/
const PROSE = [
  "space-y-3 text-sm leading-relaxed text-grid-fg",
  "[&_a]:text-grid-action [&_a]:underline [&_a]:underline-offset-4",
  "[&_h1]:text-xl [&_h1]:font-medium [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:border-b [&_h1]:border-line [&_h1]:pb-2",
  "[&_h2]:text-lg [&_h2]:font-medium [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-1.5",
  "[&_h3]:font-medium [&_h3]:mt-5 [&_h4]:font-medium [&_h5]:font-medium [&_h6]:font-medium [&_h6]:text-grid-muted",
  "[&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-3 [&_blockquote]:text-grid-muted",
  "[&_code]:bg-grid-soft [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_code]:rounded-sm",
  "[&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-line [&_pre]:bg-grid-card [&_pre]:p-3 [&_pre]:rounded-md",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
  "[&_ol]:list-decimal [&_ol]:list-outside [&_ol]:ps-5",
  "[&_ul]:list-disc [&_ul]:list-outside [&_ul]:ps-5",
  "[&_li]:ps-1 [&_li]:my-0.5",
  // GFM task lists: the checkbox is rendered by marked as a disabled input.
  "[&_li:has(>input[type=checkbox])]:list-none [&_li:has(>input[type=checkbox])]:-ms-5",
  "[&_input[type=checkbox]]:me-1.5 [&_input[type=checkbox]]:align-middle",
  "[&_hr]:border-line [&_hr]:my-6",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto",
  "[&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-start [&_th]:bg-grid-soft",
  "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md",
  "[&_details]:border [&_details]:border-line [&_details]:rounded-md [&_details]:p-2",
  "[&_summary]:cursor-pointer [&_summary]:font-medium",
  "[&_kbd]:border [&_kbd]:border-line [&_kbd]:bg-grid-soft [&_kbd]:px-1.5 [&_kbd]:rounded-sm [&_kbd]:font-mono [&_kbd]:text-xs",
  // Codes and identifiers stay LTR inside RTL prose.
  "[&_code]:[unicode-bidi:plaintext] [&_pre]:[direction:ltr]",
].join(" ")
