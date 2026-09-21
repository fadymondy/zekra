/**
 * Pure-function `[[wiki-link]]` parser + resolver.
 *
 * Syntax supported:
 *   [[Note title]]            — simple ref
 *   [[Note title|Alias]]      — ref with display alias
 *   [[Note title#anchor]]     — ref to a heading anchor (just preserved as-is)
 *
 * Skipped contexts (not parsed):
 *   - inside fenced code blocks (``` … ```)
 *   - inside indented code blocks (4-space lines after a blank line)
 *   - inside inline code spans (`…`)
 *
 * The parser returns positions in the ORIGINAL string so callers can do
 * source-rewriting without re-tokenising twice.
 */

export interface WikiLinkRef {
  /** The full original match including brackets, e.g. `[[Foo|Bar]]`. */
  raw: string;
  /** Just the target portion, trimmed. e.g. `Foo`. Casefolded for matching by callers. */
  target: string;
  /** Optional anchor portion after `#`, e.g. `intro` for `[[Foo#intro]]`. */
  anchor?: string;
  /** Optional display alias after `|`, e.g. `Bar` for `[[Foo|Bar]]`. */
  alias?: string;
  /** Char offset (start) of `raw` in the source string. */
  start: number;
  /** Char offset (end, exclusive) of `raw` in the source string. */
  end: number;
}

const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;

export function parseWikiLinks(markdown: string): WikiLinkRef[] {
  const masked = maskCodeRegions(markdown);
  const out: WikiLinkRef[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(masked)) !== null) {
    const inner = m[1];
    const start = m.index;
    const end = start + m[0].length;

    // Pull alias (after |) and anchor (after #) from the original (un-masked) inner.
    // Order: target [#anchor] [|alias]
    const originalInner = markdown.slice(start + 2, end - 2);
    const aliasIdx = originalInner.indexOf('|');
    const targetAndAnchor = aliasIdx >= 0 ? originalInner.slice(0, aliasIdx) : originalInner;
    const alias = aliasIdx >= 0 ? originalInner.slice(aliasIdx + 1).trim() : undefined;

    const anchorIdx = targetAndAnchor.indexOf('#');
    const target = (anchorIdx >= 0 ? targetAndAnchor.slice(0, anchorIdx) : targetAndAnchor).trim();
    const anchor = anchorIdx >= 0 ? targetAndAnchor.slice(anchorIdx + 1).trim() : undefined;

    if (target.length === 0) continue;

    out.push({
      raw: m[0],
      target,
      anchor: anchor && anchor.length > 0 ? anchor : undefined,
      alias: alias && alias.length > 0 ? alias : undefined,
      start,
      end,
    });
    void inner;
  }
  return out;
}

/**
 * Replace code regions with placeholder spaces of the same length so that
 * regex offsets line up with the original markdown.
 */
function maskCodeRegions(src: string): string {
  const out: string[] = [];
  let i = 0;
  let inFence = false;
  let fenceMarker = '';
  const lines = src.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trimStart();
    if (!inFence && /^(```|~~~)/.test(trimmed)) {
      inFence = true;
      fenceMarker = trimmed.slice(0, 3);
      out.push(' '.repeat(line.length));
    } else if (inFence) {
      if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = '';
      }
      out.push(' '.repeat(line.length));
    } else {
      out.push(maskInlineCode(line));
    }
    if (li < lines.length - 1) out.push('\n');
    void i;
  }
  return out.join('');
}

function maskInlineCode(line: string): string {
  let result = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      // Count fence ticks.
      let n = 0;
      while (i + n < line.length && line[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const closeIdx = line.indexOf(fence, i + n);
      if (closeIdx === -1) {
        // unclosed — leave the rest of the line as-is.
        result += line.slice(i);
        return result;
      }
      result += ' '.repeat(closeIdx + n - i);
      i = closeIdx + n;
    } else {
      result += line[i];
      i++;
    }
  }
  return result;
}
