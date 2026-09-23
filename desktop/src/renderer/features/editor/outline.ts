import { tokenize } from "@/lib/markdown";

import { stripMarkdown } from "../notes/notes-model";

/*
The outline rail's model: a note's top-level headings, parsed with the same
lexer the renderer uses (marked), so setext headings count and a "#" inside a
code fence does not.

Each heading carries:
  index   its position among top-level headings — the n-th h1…h6 the renderer
          and TipTap put directly in the pane (headings nested in lists or
          quotes are not outline entries in either)
  offset  its character offset in the markdown, for the source editor
*/

export type OutlineItem = { index: number; depth: number; text: string; offset: number; line: number };

export function outlineOf(markdown: string): OutlineItem[] {
  if (!markdown.trim()) return [];
  let tokens;
  try {
    tokens = tokenize(markdown);
  } catch {
    return [];
  }
  const out: OutlineItem[] = [];
  let offset = 0;
  for (const tok of tokens) {
    const t = tok as { type: string; raw?: string; depth?: number; text?: string };
    if (t.type === "heading") {
      const lead = (t.raw ?? "").length - (t.raw ?? "").trimStart().length;
      const at = offset + lead;
      out.push({
        index: out.length,
        depth: t.depth ?? 1,
        text: stripMarkdown(t.text ?? "") || "…",
        offset: at,
        line: markdown.slice(0, at).split("\n").length,
      });
    }
    offset += (t.raw ?? "").length;
  }
  return out;
}

/** The pane's top-level headings in document order (matches outlineOf). */
export function headingElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter(
    (h) => !h.closest("blockquote, li, table, details"),
  );
}

/** Which heading the reader is in: the last one above the viewport's top third. */
export function activeHeading(root: HTMLElement, scroller: HTMLElement): number {
  const hs = headingElements(root);
  const limit = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
  let active = -1;
  for (let i = 0; i < hs.length; i++) {
    if (hs[i].getBoundingClientRect().top <= limit) active = i;
    else break;
  }
  return active;
}
