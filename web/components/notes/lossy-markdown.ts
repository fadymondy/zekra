/*
Detect markdown the editor's schema cannot round-trip.

markdown -> TipTap -> markdown silently drops any construct with no node in
the schema. For most of them that was fixable by adding a node (tables, task
lists — see editor-extensions.ts), but footnotes and raw HTML blocks are not
modelled, and opening such a note in the editor would rewrite the author's
content the moment it saved.

So the editor asks first. This is the check behind that: it is deliberately
conservative — a false positive costs a user one click to edit as plain
markdown, a false negative costs them their content.

Kept separate from the component so it is testable without a DOM.
*/

export type LossyConstruct = "footnote" | "html-block"

export interface LossyFinding {
  kind: LossyConstruct
  /** Human-readable, shown in the warning. */
  label: string
  /** First matched snippet, to show the user what was found. */
  sample: string
}

/** Block-level HTML the schema cannot model. Inline tags round-trip fine. */
const HTML_BLOCK = /^[ \t]*<(details|summary|table|div|section|article|figure|iframe|form|aside|header|footer|dl|pre)\b[^>]*>/im

/** A footnote definition; the reference alone is harmless text. */
const FOOTNOTE_DEF = /^[ \t]*\[\^[^\]]+\]:/m

/**
 * Anything inside a fenced code block is a literal example, not a construct.
 * Stripping fences first is what stops a note ABOUT html from being flagged.
 */
function withoutCodeFences(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/^(?: {4}|\t).*$/gm, "")
}

export function findLossyConstructs(markdown: string): LossyFinding[] {
  const src = withoutCodeFences(markdown ?? "")
  const out: LossyFinding[] = []

  const fn = src.match(FOOTNOTE_DEF)
  if (fn) {
    out.push({
      kind: "footnote",
      label: "Footnotes",
      sample: fn[0].trim().slice(0, 60),
    })
  }

  const html = src.match(HTML_BLOCK)
  if (html) {
    out.push({
      kind: "html-block",
      label: "Raw HTML blocks",
      sample: html[0].trim().slice(0, 60),
    })
  }

  return out
}

export function isLossy(markdown: string): boolean {
  return findLossyConstructs(markdown).length > 0
}
