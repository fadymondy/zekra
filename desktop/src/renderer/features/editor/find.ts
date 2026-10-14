/*
Find-in-note (⌘F) helpers.

Rendered panes (the live editor, the preview) are searched in the DOM and the
hits painted with the CSS Custom Highlight API — no DOM mutation, so neither
ProseMirror nor React notices, and nothing can leak into the saved markdown.
The source editor is a <textarea>: hits are offsets and the current one is
selected, scrolled to with a measuring mirror.

The highlight colours are the house selection gold.
*/

const STYLE_ID = "zk-find-style";

export function ensureFindStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    "::highlight(zk-find){background-color:color-mix(in oklab, var(--grid-gold) 32%, transparent);}",
    "::highlight(zk-find-current){background-color:var(--grid-gold);color:var(--grid-bg);}",
    ".zk-source::selection{background-color:color-mix(in oklab, var(--grid-action) 35%, transparent);}",
    // The live editor: the web's WYSIWYG draws a bordered box (it sits in a
    // form there); on the desktop the page IS the note, Apple Notes style.
    ".zk-live [data-word-wrap]{border-color:transparent!important;background:transparent!important;padding:0!important;border-radius:0!important;}",
    ".zk-live .ProseMirror{min-height:55vh;}",
    ".zk-live .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:var(--grid-muted);float:inline-start;height:0;pointer-events:none;}",
    // Per-block direction: each paragraph, heading, list item, quote and cell
    // reads in the direction of its own text (the editor also sets dir="auto"
    // on them — web editor-extensions.ts BlockDirection; this is the fallback,
    // and the whole mechanism for the read-only render).
    ".zk-live .ProseMirror :is(p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dt,dd),.zk-reader :is(p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dt,dd,figcaption){unicode-bidi:plaintext;text-align:start;}",
    ".zk-live .ProseMirror pre{direction:ltr;text-align:left;}",
    // Checklists (TipTap taskList: li > label > checkbox, then div > p). The
    // checkbox sits at the item's inline START, next to its text: a flex row
    // with logical spacing, in the direction of the item's own paragraph. The
    // li's dir="auto" can't find it (the <p> carries its own dir, so it is
    // skipped) and falls back to the UI's, which put an Arabic item's box on
    // the left in an English UI, away from its right-aligned text.
    ".zk-live .ProseMirror ul[data-type=taskList]{list-style:none;padding-inline-start:0.25rem;}",
    ".zk-live .ProseMirror li[data-type=taskItem]{display:flex;align-items:flex-start;gap:0;padding-inline-start:0;}",
    ".zk-live .ProseMirror li[data-type=taskItem]:has(> div > :first-child:dir(rtl)){direction:rtl;}",
    ".zk-live .ProseMirror li[data-type=taskItem]:has(> div > :first-child:dir(ltr)){direction:ltr;}",
    ".zk-live .ProseMirror li[data-type=taskItem] > label{flex:none;margin-inline-end:0.5rem;margin-top:0.35em;line-height:1;user-select:none;}",
    ".zk-live .ProseMirror li[data-type=taskItem] > div{flex:1 1 auto;min-width:0;}",
  ].join("\n");
  document.head.appendChild(style);
}

/** Case-insensitive occurrences of `query` in the text under `root`. */
export function domMatches(root: HTMLElement, query: string): Range[] {
  const q = query.toLocaleLowerCase();
  if (!q) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("script, style, .zk-code-menu, .zk-table-menu") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").toLocaleLowerCase();
    let i = text.indexOf(q);
    while (i !== -1 && out.length < 2000) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + q.length);
      out.push(r);
      i = text.indexOf(q, i + q.length);
    }
  }
  return out;
}

export function paintHighlights(ranges: Range[], current: number): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  ensureFindStyles();
  CSS.highlights.set("zk-find", new Highlight(...ranges.filter((_, i) => i !== current)));
  const cur = ranges[current];
  if (cur) CSS.highlights.set("zk-find-current", new Highlight(cur));
  else CSS.highlights.delete("zk-find-current");
}

export function clearHighlights(): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  CSS.highlights.delete("zk-find");
  CSS.highlights.delete("zk-find-current");
}

/** Scroll the nearest scrollable ancestor so `range` sits in its top third. */
export function scrollRangeIntoView(range: Range): void {
  const el = range.startContainer.parentElement;
  if (!el) return;
  const scroller = scrollParent(el);
  if (!scroller) {
    el.scrollIntoView({ block: "center" });
    return;
  }
  const r = range.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  if (r.top < s.top + 24 || r.bottom > s.bottom - 24) {
    scroller.scrollTop += r.top - s.top - scroller.clientHeight / 3;
  }
}

export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Offsets of `query` in `text`, case-insensitive. */
export function textMatches(text: string, query: string): number[] {
  const q = query.toLocaleLowerCase();
  if (!q) return [];
  const hay = text.toLocaleLowerCase();
  const out: number[] = [];
  let i = hay.indexOf(q);
  while (i !== -1 && out.length < 5000) {
    out.push(i);
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}

/**
 * The y offset (content px) of character `offset` in a textarea — measured
 * with an off-screen mirror carrying the textarea's own text metrics, so it
 * is right with word wrap on.
 */
export function caretTop(ta: HTMLTextAreaElement, offset: number): number {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  const props = [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth",
    "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight",
    "lineHeight", "letterSpacing", "tabSize", "whiteSpace", "wordBreak", "overflowWrap", "direction",
  ] as const;
  for (const p of props) (mirror.style as unknown as Record<string, string>)[p] = cs[p] as string;
  Object.assign(mirror.style, { position: "fixed", visibility: "hidden", top: "0", left: "-99999px", height: "auto", overflow: "hidden" });
  if (cs.whiteSpace === "pre") mirror.style.whiteSpace = "pre";
  else mirror.style.whiteSpace = "pre-wrap";
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/** Select [start, end) in a textarea and scroll it to the top third, without
 *  taking focus away from wherever it is (e.g. the find field). */
export function revealInTextarea(ta: HTMLTextAreaElement, start: number, end: number, focus = false): void {
  if (focus) ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  const y = caretTop(ta, start);
  ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
}

/** 1-based line and column of `offset` in `text`. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const nl = before.lastIndexOf("\n");
  return { line: before.split("\n").length, col: offset - nl };
}
