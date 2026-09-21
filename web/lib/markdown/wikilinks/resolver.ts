/**
 * Resolve `[[wiki-link]]` targets against a corpus of notes, and build a
 * reverse map (backlinks) for the corpus.
 *
 * The matching is case-insensitive on the trimmed title. Multiple notes
 * sharing the same title produce an `ambiguous` resolution; callers can
 * surface a picker.
 */

import { parseWikiLinks } from './parser.ts';
import type { WikiLinkRef } from './parser.ts';

export interface NoteRef {
  id: string;
  title: string;
}

export type Resolution =
  | { status: 'ok'; match: NoteRef }
  | { status: 'ambiguous'; matches: NoteRef[] }
  | { status: 'broken' };

export interface NoteWithBody extends NoteRef {
  body: string;
}

export interface BacklinkEntry {
  /** Note that contains the link. */
  source: NoteRef;
  /** Verbatim wiki-link as it appeared in the source body. */
  raw: string;
  /** Resolved alias (or the target if no alias). */
  display: string;
  /** Anchor portion if present. */
  anchor?: string;
}

export type BacklinksMap = Map<string, BacklinkEntry[]>;

export function resolveWikiLink(target: string, notes: NoteRef[]): Resolution {
  const needle = normalizeTitle(target);
  const matches = notes.filter(n => normalizeTitle(n.title) === needle);
  if (matches.length === 0) return { status: 'broken' };
  if (matches.length === 1) return { status: 'ok', match: matches[0] };
  return { status: 'ambiguous', matches };
}

/**
 * Walk every note's body, parse wiki-links, and record each link from
 * source → target id (when resolvable). Ambiguous links currently record
 * one entry per candidate so the backlinks panel surfaces them on each side.
 */
export function buildBacklinks(notes: NoteWithBody[]): BacklinksMap {
  const out: BacklinksMap = new Map();
  const refs: NoteRef[] = notes.map(n => ({ id: n.id, title: n.title }));
  for (const source of notes) {
    const links = parseWikiLinks(source.body);
    for (const link of links) {
      const resolution = resolveWikiLink(link.target, refs);
      if (resolution.status === 'broken') continue;
      const targets = resolution.status === 'ok' ? [resolution.match] : resolution.matches;
      for (const target of targets) {
        if (target.id === source.id) continue;
        const list = out.get(target.id) ?? [];
        list.push({
          source: { id: source.id, title: source.title },
          raw: link.raw,
          display: link.alias ?? link.target,
          anchor: link.anchor,
        });
        out.set(target.id, list);
      }
    }
  }
  return out;
}

/**
 * Public for tests; lowercases + collapses inner whitespace + strips
 * surrounding whitespace.
 */
export function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type { WikiLinkRef };
