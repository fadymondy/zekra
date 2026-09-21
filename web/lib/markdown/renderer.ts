import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { rewriteWikiLinks } from './wikilinks/renderer.ts';
import type { NoteRef } from './wikilinks/resolver.ts';
import { CODE_BLOCK_ATTRS, codeBlockExtension } from './code-block.ts';
import { TABLE_ATTRS, tableExtension } from './table.ts';

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  // Was marked-highlight upstream. codeBlockExtension does the highlighting
  // itself because it also emits the block chrome (title bar, actions menu),
  // and both want renderer.code — registering both would silently drop one.
  marked.use(codeBlockExtension);
  marked.use(tableExtension);
  marked.setOptions({ gfm: true, breaks: false });
  initialized = true;
}

export interface RenderOptions {
  /**
   * If true (default), pre-extract ```mermaid blocks and replace them with
   * `<div class="mermaid" data-mermaid-index="N"></div>` placeholders.
   * The caller is then expected to fill the placeholders with the original
   * mermaid source after the HTML lands in the DOM, then call mermaid.render
   * on each. Set to false to leave mermaid blocks as plain code blocks.
   */
  extractMermaid?: boolean;
  /**
   * When provided, rewrites `[[wiki-link]]` references into anchor tags
   * resolved against this corpus. Pass an empty array to keep parsing on
   * but mark every link broken; omit to skip wiki-link processing entirely
   * (so the brackets render as literal text via marked).
   */
  notes?: NoteRef[];
}

export interface RenderResult {
  html: string;
  /** Mermaid sources extracted from the markdown, indexed by `data-mermaid-index`. */
  mermaidBlocks: string[];
}

/**
 * Marked-and-sanitized HTML rendering of a markdown string.
 *
 * Same pipeline used by both the VSCode webview and the Electron renderer:
 *   marked + marked-highlight (highlight.js common languages)
 *   → DOMPurify sanitize
 *   → optional mermaid placeholder extraction.
 */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): RenderResult {
  ensureInitialized();
  const { extractMermaid = true, notes } = options;
  const mermaidBlocks: string[] = [];

  let source = markdown;
  if (notes !== undefined) {
    source = rewriteWikiLinks(source, notes);
  }
  if (extractMermaid) {
    source = source.replace(/```mermaid\s*\n([\s\S]*?)\n```/g, (_, code: string) => {
      const idx = mermaidBlocks.push(code) - 1;
      return `<div class="mermaid" data-mermaid-index="${idx}"></div>`;
    });
  }

  const rawHtml = marked.parse(source, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['mermaid'],
    ADD_ATTR: [
      'data-mermaid-index',
      'data-mermaid-source',
      'data-wikilink-id',
      'data-wikilink-ids',
      'data-wikilink-target',
      'data-wikilink-anchor',
      'class',
      'target',
      // Code-block chrome: the title bar, and the hooks the React layer
      // delegates its copy/download/PNG/line-number actions from.
      ...CODE_BLOCK_ATTRS,
      ...TABLE_ATTRS,
    ],
  });

  return { html: safeHtml, mermaidBlocks };
}

/**
 * Apply the extracted mermaid sources back to a freshly-mounted DOM.
 * Call after writing `result.html` into the page.
 */
export function applyMermaidPlaceholders(root: Element, mermaidBlocks: string[]): void {
  root.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-index]').forEach(el => {
    const idx = Number(el.getAttribute('data-mermaid-index'));
    if (!Number.isNaN(idx) && mermaidBlocks[idx] !== undefined) {
      el.textContent = mermaidBlocks[idx];
      el.removeAttribute('data-mermaid-index');
    }
  });
}
