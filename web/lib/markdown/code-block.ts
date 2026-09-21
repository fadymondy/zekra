import hljs from 'highlight.js/lib/common';
import type { MarkedExtension, Tokens } from 'marked';

/*
Fenced code blocks, rendered with the chrome mark-it-down uses: traffic-light
dots, a filename/language label, and a menu the React layer attaches actions to
(copy, download, export PNG, line numbers).

This REPLACES marked-highlight rather than stacking on it. Both want
renderer.code, and whichever is registered last wins — so running both would
silently drop one's output. Highlighting is therefore done here.

The emitted shape is plain HTML so it survives DOMPurify and can be injected
with dangerouslySetInnerHTML; the React layer finds the buttons by data
attribute and delegates from a single listener rather than mounting a root per
block (a long note can hold dozens).

Info-string grammar, a superset of plain markdown:
    ```go                 -> language go, label "go"
    ```go main.go         -> language go, label "main.go"
    ```yml snippet.yml    -> language yaml, label "snippet.yml"
Anything after the first token is treated as the display name, which is how a
filename reaches the title bar.
*/

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Default filename when the fence names a language but no file. */
const EXT: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb', rust: 'rs',
  markdown: 'md', yaml: 'yml', shell: 'sh', bash: 'sh', plaintext: 'txt',
};

export interface ParsedInfo {
  lang: string;
  label: string;
  filename: string;
}

/** Split a fence info string into a highlight language and a display label. */
export function parseInfo(info: string): ParsedInfo {
  const parts = (info ?? '').trim().split(/\s+/).filter(Boolean);
  const raw = parts[0] ?? '';
  const named = parts.slice(1).join(' ');
  // hljs knows aliases (yml -> yaml, ts -> typescript); normalise so the class
  // and the extension agree, and fall back rather than throwing on nonsense.
  const lang = hljs.getLanguage(raw) ? raw : '';
  const canonical = lang ? (hljs.getLanguage(lang)?.name?.toLowerCase() ?? lang) : 'plaintext';
  const ext = EXT[canonical] ?? (lang || 'txt');
  return {
    lang: lang || 'plaintext',
    label: named || raw || 'text',
    filename: named || `snippet.${ext}`,
  };
}

export const codeBlockExtension: MarkedExtension = {
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const { lang: language, label, filename } = parseInfo(lang ?? '');
      let body: string;
      try {
        body = hljs.highlight(text, { language }).value;
      } catch {
        // An unknown or broken grammar must degrade to plain text, never throw
        // mid-render and blank the whole note.
        body = escapeHtml(text);
      }
      // data-code carries the ORIGINAL source: copy and download must return
      // what the author wrote, not the highlighted markup with its spans.
      return [
        `<figure class="zk-code" data-lang="${escapeHtml(language)}" data-filename="${escapeHtml(filename)}">`,
        `<figcaption class="zk-code-bar">`,
        `<span class="zk-code-lights" aria-hidden="true"><i></i><i></i><i></i></span>`,
        `<span class="zk-code-name">${escapeHtml(label)}</span>`,
        `<button type="button" class="zk-code-menu" data-zk-code-menu aria-label="Code actions" aria-haspopup="menu">`,
        `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>`,
        `</button>`,
        `</figcaption>`,
        `<pre><code class="hljs language-${escapeHtml(language)}" data-code="${escapeHtml(text)}">${body}</code></pre>`,
        `</figure>`,
      ].join('');
    },
  },
};

/** Attributes DOMPurify must keep for the chrome and its actions to work. */
export const CODE_BLOCK_ATTRS = ['data-lang', 'data-filename', 'data-code', 'data-zk-code-menu', 'aria-haspopup'];
