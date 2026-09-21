/**
 * Rewrite `[[wiki-links]]` in a markdown source string into inline HTML
 * anchors that survive the marked + DOMPurify pipeline:
 *
 *   ok        → <a class="mid-wikilink" data-wikilink-id="ID">display</a>
 *   ambiguous → <a class="mid-wikilink mid-wikilink-ambiguous" data-wikilink-target="title">display</a>
 *   broken    → <span class="mid-wikilink mid-wikilink-broken" data-wikilink-target="title">display</span>
 *
 * The webview attaches click handlers in a single pass via querySelectorAll.
 * Anchor (`#heading`) is preserved on the data-wikilink-anchor attribute.
 */

import { parseWikiLinks } from './parser.ts';
import { resolveWikiLink } from './resolver.ts';
import type { NoteRef } from './resolver.ts';

export function rewriteWikiLinks(markdown: string, notes: NoteRef[]): string {
  const refs = parseWikiLinks(markdown);
  if (refs.length === 0) return markdown;
  const out: string[] = [];
  let cursor = 0;
  for (const ref of refs) {
    out.push(markdown.slice(cursor, ref.start));
    out.push(renderRef(ref, notes));
    cursor = ref.end;
  }
  out.push(markdown.slice(cursor));
  return out.join('');
}

function renderRef(ref: ReturnType<typeof parseWikiLinks>[number], notes: NoteRef[]): string {
  const display = ref.alias ?? ref.target;
  const safeDisplay = escapeHtml(display);
  const safeTarget = escapeAttr(ref.target);
  const anchorAttr = ref.anchor ? ` data-wikilink-anchor="${escapeAttr(ref.anchor)}"` : '';
  const resolution = resolveWikiLink(ref.target, notes);
  if (resolution.status === 'ok') {
    return `<a class="mid-wikilink" data-wikilink-id="${escapeAttr(resolution.match.id)}" data-wikilink-target="${safeTarget}"${anchorAttr} href="#" title="Open ${escapeAttr(resolution.match.title)}">${safeDisplay}</a>`;
  }
  if (resolution.status === 'ambiguous') {
    const ids = resolution.matches.map(m => m.id).join(',');
    return `<a class="mid-wikilink mid-wikilink-ambiguous" data-wikilink-ids="${escapeAttr(ids)}" data-wikilink-target="${safeTarget}"${anchorAttr} href="#" title="${resolution.matches.length} notes share this title — click to pick">${safeDisplay}</a>`;
  }
  return `<span class="mid-wikilink mid-wikilink-broken" data-wikilink-target="${safeTarget}"${anchorAttr} title="No note titled “${escapeAttr(ref.target)}” — click to create">${safeDisplay}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
