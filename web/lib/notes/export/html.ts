import { renderMarkdown } from '../../markdown/index.ts'
import { themeById, themeVars } from '../../markdown/themes/apply.ts'

/*
Standalone HTML export.

The file has to survive leaving the app, so every style is inlined and nothing
is fetched: no stylesheet link, no web font, no script. Someone opening the
export on a machine that has never heard of Zekra must see the same document.

That rules out reusing globals.css by reference, hence the duplicated rules
below. They are deliberately a SUBSET — the reading surface only — rather than
a copy of the app's CSS.
*/

export interface HtmlExportOptions {
  title: string
  /** Reading theme id, or null for a neutral GitHub-like default. */
  theme?: string | null
  /** Emitted as dir on <html>; "auto" lets the browser decide per block. */
  dir?: 'ltr' | 'rtl' | 'auto'
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Fallback palette when no reading theme is chosen: GitHub Light. */
const NEUTRAL: Record<string, string> = {
  '--nq-bg': '#ffffff',
  '--nq-surface': '#ffffff',
  '--nq-surface-soft': '#f6f8fa',
  '--nq-fg': '#1f2328',
  '--nq-fg-body': '#1f2328',
  '--nq-fg-muted': '#656d76',
  '--nq-line': '#d0d7de',
  '--nq-action': '#0969da',
  '--hl-comment': '#6e7781',
  '--hl-keyword': '#cf222e',
  '--hl-string': '#0a3069',
  '--hl-number': '#0550ae',
  '--hl-title': '#8250df',
  '--hl-attr': '#0550ae',
  '--hl-type': '#953800',
  '--hl-meta': '#6e7781',
  '--zk-code-bg': '#f6f8fa',
}

function varsFor(themeId?: string | null): Record<string, string> {
  const theme = themeById(themeId)
  return theme ? { ...NEUTRAL, ...themeVars(theme) } : NEUTRAL
}

/** The reading-surface subset of globals.css, for a self-contained file. */
function baseCss(vars: Record<string, string>): string {
  const decls = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
  return `
:root{${decls}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.25rem;background:var(--nq-bg);color:var(--nq-fg);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
main{max-width:56rem;margin:0 auto}
a{color:var(--nq-action)}
h1,h2{border-bottom:1px solid var(--nq-line);padding-bottom:.3em}
code{background:var(--nq-surface-soft);padding:.1em .3em;border-radius:3px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;unicode-bidi:plaintext}
pre{overflow-x:auto;padding:0;margin:0;direction:ltr}
pre code{background:none;padding:0}
blockquote{margin:0;padding-left:1em;border-left:3px solid var(--nq-line);color:var(--nq-fg-muted)}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--nq-line);padding:.4em .6em;text-align:start}
th{background:var(--nq-surface-soft)}
img{max-width:100%;height:auto}
hr{border:0;border-top:1px solid var(--nq-line);margin:2em 0}
kbd{border:1px solid var(--nq-line);background:var(--nq-surface-soft);padding:.1em .4em;border-radius:3px;font-size:.85em}
details{border:1px solid var(--nq-line);border-radius:6px;padding:.5em}
summary{cursor:pointer;font-weight:500}
.zk-code{margin:.75rem 0;border:1px solid var(--nq-line);border-radius:8px;overflow:hidden;background:var(--zk-code-bg)}
.zk-code-bar{display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;
  border-bottom:1px solid var(--nq-line);background:var(--nq-surface-soft);direction:ltr}
.zk-code-lights{display:inline-flex;gap:.3rem}
.zk-code-lights i{width:.65rem;height:.65rem;border-radius:9999px;background:currentColor}
.zk-code-lights i:nth-child(1){color:#ff5f57}.zk-code-lights i:nth-child(2){color:#febc2e}
.zk-code-lights i:nth-child(3){color:#28c840}
.zk-code-name{flex:1;text-align:center;font-size:.75rem;color:var(--nq-fg-muted);
  font-family:ui-monospace,monospace}
.zk-code>pre{padding:.75rem}
.zk-table{margin:.75rem 0;border:1px solid var(--nq-line);border-radius:8px;overflow:hidden}
.zk-table-scroll{overflow-x:auto}
.hljs-comment,.hljs-quote{color:var(--hl-comment);font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag{color:var(--hl-keyword)}
.hljs-string,.hljs-regexp{color:var(--hl-string)}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link{color:var(--hl-number)}
.hljs-title,.hljs-section,.hljs-name{color:var(--hl-title)}
.hljs-attr,.hljs-attribute,.hljs-variable{color:var(--hl-attr)}
.hljs-type,.hljs-built_in,.hljs-class{color:var(--hl-type)}
.hljs-meta{color:var(--hl-meta)}
/* Interactive chrome is meaningless in a static file. */
.zk-code-menu,.zk-table-menu,.zk-table-filter,.zk-sort-caret{display:none}
.zk-table-sort{background:none;border:0;font:inherit;color:inherit;padding:.4em .6em;text-align:start}
@media print{body{padding:0}a{text-decoration:none}}
`.trim()
}

/**
 * A complete, self-contained HTML document for one note.
 *
 * The body is rendered through the same pipeline as the app, so an export
 * cannot drift from what the reader saw — including the sanitize step, which
 * matters as much here as on screen.
 */
export function noteToHtml(markdown: string, options: HtmlExportOptions): string {
  const { html } = renderMarkdown(markdown ?? '', { extractMermaid: false })
  const dir = options.dir ?? 'auto'
  return `<!doctype html>
<html lang="en" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>${baseCss(varsFor(options.theme))}</style>
</head>
<body><main>${html}</main></body>
</html>`
}
