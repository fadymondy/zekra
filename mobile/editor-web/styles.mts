import { CODE_FONT_STACK } from "../src/features/editor/engine-core.ts";

/*
The page stylesheet. Colours are ONLY --grid-* / --hl-* / --zk-* variables
(filled by theme.mts from a reading theme or the app palette), so a theme
change is a variable swap and nothing re-renders.

The reader rules port web's globals.css (code-block chrome, interactive
tables, hljs token rules) and note-markdown.tsx's PROSE classes; the editor
rules port note-editor-wysiwyg.tsx's EDITOR_PROSE. Both share .zk-prose so
reading and typing look the same.
*/

export const CSS = String.raw`
:root{--zk-font:system-ui,sans-serif;--zk-size:16px;--zk-maxw:none;--zk-padx:28px;--zk-code-font:${CODE_FONT_STACK}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;background:var(--grid-bg);color:var(--grid-fg)}
body{font-family:var(--zk-font);font-size:var(--zk-size);line-height:1.65;-webkit-text-size-adjust:100%;text-size-adjust:100%;overflow-wrap:break-word;word-wrap:break-word}
#zk-root{max-width:var(--zk-maxw);margin:0 auto;padding:6px var(--zk-padx) 40vh}
html[data-purpose=export] #zk-root{padding-bottom:24px}
::selection{background:color-mix(in srgb,var(--grid-action) 28%,transparent)}

/* ── prose: shared by reader and editor ─────────────────────────────── */
.zk-prose{color:var(--grid-fg)}
.zk-prose>:first-child{margin-top:0}
.zk-prose p{margin:0 0 .8em}
.zk-prose a{color:var(--grid-action);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.zk-prose h1,.zk-prose h2,.zk-prose h3,.zk-prose h4,.zk-prose h5,.zk-prose h6{font-weight:500;line-height:1.3;margin:1.3em 0 .5em;color:var(--grid-fg)}
.zk-prose h1{font-size:1.6em;border-bottom:1px solid var(--grid-line);padding-bottom:.25em}
.zk-prose h2{font-size:1.3em;border-bottom:1px solid var(--grid-line);padding-bottom:.2em}
.zk-prose h3{font-size:1.12em}
.zk-prose h4,.zk-prose h5{font-size:1em}
.zk-prose h6{font-size:.92em;color:var(--grid-muted)}
.zk-prose blockquote{margin:.8em 0;padding-inline-start:.9em;border-inline-start:3px solid var(--grid-line);color:var(--grid-muted)}
.zk-prose blockquote>:last-child{margin-bottom:0}
.zk-prose code{font-family:var(--zk-code-font);font-size:.86em;background:var(--grid-soft);padding:.12em .35em;border-radius:4px;unicode-bidi:plaintext}
.zk-prose pre{direction:ltr;text-align:left;overflow-x:auto;margin:.8em 0;padding:.8em 1em;background:var(--zk-code-bg,var(--grid-card));border:1px solid var(--grid-line);border-radius:8px;font-family:var(--zk-code-font);font-size:.84em;line-height:1.55;-webkit-overflow-scrolling:touch}
.zk-prose pre code{background:none;padding:0;border-radius:0;font-size:inherit;white-space:pre;unicode-bidi:normal}
html[data-wrap=on] .zk-prose pre code{white-space:pre-wrap;word-break:break-word}
html[data-wrap=on] .zk-code[data-lines=on] pre code{white-space:pre;word-break:normal}
.zk-prose ul,.zk-prose ol{padding-inline-start:1.45em;margin:.5em 0 .8em}
.zk-prose li{margin:.2em 0;padding-inline-start:.15em}
.zk-prose li>p{margin:0 0 .3em}
.zk-prose hr{border:0;border-top:1px solid var(--grid-line);margin:1.6em 0}
.zk-prose img{max-width:100%;height:auto;border-radius:6px;vertical-align:middle}
.zk-prose img.zk-img-pending{min-height:90px;min-width:140px;background:var(--grid-soft);border-radius:6px}
.zk-prose img.zk-img-failed{min-height:48px;min-width:96px;outline:1px dashed var(--grid-line);outline-offset:-1px;background:var(--grid-soft)}
.zk-prose table{border-collapse:collapse}
.zk-prose th,.zk-prose td{border:1px solid var(--grid-line);padding:.35em .6em;text-align:start;vertical-align:top}
.zk-prose th{background:var(--grid-soft);font-weight:500}
.zk-prose details{border:1px solid var(--grid-line);border-radius:6px;padding:.45em .75em;margin:.8em 0}
.zk-prose summary{cursor:pointer;font-weight:500}
.zk-prose details[open]>summary{margin-bottom:.4em}
.zk-prose kbd{border:1px solid var(--grid-line);border-bottom-width:2px;background:var(--grid-soft);padding:.05em .4em;border-radius:4px;font-family:var(--zk-code-font);font-size:.8em}
.zk-prose mark{background:color-mix(in srgb,var(--grid-gold,#c9a227) 35%,transparent);color:inherit;border-radius:2px}
.zk-prose input[type=checkbox]{accent-color:var(--grid-action);margin-inline-end:.45em;vertical-align:middle;width:1.05em;height:1.05em}
.zk-prose dl dt{font-weight:500}.zk-prose dl dd{margin-inline-start:1.2em}

/* GFM task lists in the reader: marked renders <li><input type=checkbox> */
.zk-reader li:has(>input[type=checkbox]),.zk-reader li:has(>p>input[type=checkbox]){list-style:none;margin-inline-start:-1.3em}

/* ── code-block chrome (web globals.css) ─────────────────────────────── */
.zk-code{margin:.8em 0;border:1px solid var(--grid-line);border-radius:8px;overflow:hidden;background:var(--zk-code-bg,var(--grid-card))}
.zk-code-bar{display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;border-bottom:1px solid var(--grid-line);background:var(--grid-soft);direction:ltr}
.zk-code-lights{display:inline-flex;gap:.3rem;flex:none}
.zk-code-lights i{width:.62rem;height:.62rem;border-radius:9999px;background:currentColor}
.zk-code-lights i:nth-child(1){color:#ff5f57}.zk-code-lights i:nth-child(2){color:#febc2e}.zk-code-lights i:nth-child(3){color:#28c840}
.zk-code-name{flex:1;text-align:center;font-family:var(--zk-code-font);font-size:.72rem;color:var(--grid-muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zk-code-menu{flex:none;display:inline-flex;align-items:center;justify-content:center;width:1.9rem;height:1.6rem;border:0;border-radius:4px;background:none;color:var(--grid-muted);padding:0}
.zk-code-menu:active{background:var(--grid-line);color:var(--grid-fg)}
.zk-code-menu svg{fill:currentColor}
.zk-code>pre{margin:0;border:0;border-radius:0;background:transparent}
.zk-code[data-lines=on]>pre{display:flex;gap:.75rem}
.zk-gutter{flex:none;text-align:right;color:var(--grid-muted);user-select:none;-webkit-user-select:none;border-inline-end:1px solid var(--grid-line);padding-inline-end:.6rem;font-variant-numeric:tabular-nums;white-space:pre}
.zk-code[data-lines=on]>pre>code{flex:1;min-width:0}

/* ── interactive table (web globals.css) ─────────────────────────────── */
.zk-table{margin:.8em 0;border:1px solid var(--grid-line);border-radius:8px;overflow:hidden;background:var(--grid-card)}
.zk-table-bar{display:flex;align-items:center;gap:.6rem;padding:.45rem .55rem;border-bottom:1px solid var(--grid-line);background:var(--grid-soft)}
.zk-table-filter{display:inline-flex;align-items:center;gap:.4rem;flex:1;min-width:0;padding:.2rem .5rem;border:1px solid var(--grid-line);border-radius:6px;background:var(--grid-bg);color:var(--grid-muted);max-width:18rem}
.zk-table-filter input{flex:1;min-width:0;background:transparent;border:0;outline:none;color:var(--grid-fg);font:inherit;font-size:.8rem;padding:.15rem 0}
.zk-table-count{font-size:.72rem;color:var(--grid-muted);white-space:nowrap}
.zk-table-menu{margin-inline-start:auto;display:inline-flex;align-items:center;justify-content:center;width:1.9rem;height:1.75rem;border:0;border-radius:4px;background:none;color:var(--grid-muted);padding:0}
.zk-table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.zk-table table{width:100%;border-collapse:collapse;margin:0}
.zk-table th,.zk-table td{border:0;border-top:1px solid var(--grid-line);padding:.5rem .75rem;text-align:start;white-space:nowrap}
.zk-table tbody tr:nth-child(even){background:var(--zk-table-stripe,transparent)}
.zk-table thead th{background:var(--grid-soft);border-top:0;font-size:.69rem;letter-spacing:.06em;text-transform:uppercase;color:var(--grid-muted);padding:0}
.zk-table-sort{display:inline-flex;align-items:center;gap:.35rem;width:100%;padding:.5rem .75rem;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;text-align:start}
.zk-sort-caret::after{content:"⌄";opacity:.35;font-size:.75em}
.zk-table-sort[data-active=asc] .zk-sort-caret::after{content:"⌃";opacity:1}
.zk-table-sort[data-active=desc] .zk-sort-caret::after{content:"⌄";opacity:1}

/* ── highlight.js tokens (web globals.css; a reading theme layers its own) */
.hljs-comment,.hljs-quote{color:var(--hl-comment);font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag{color:var(--hl-keyword)}
.hljs-string,.hljs-regexp{color:var(--hl-string)}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link{color:var(--hl-number)}
.hljs-title,.hljs-section,.hljs-name,.hljs-selector-id,.hljs-selector-class{color:var(--hl-title)}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:var(--hl-attr)}
.hljs-type,.hljs-built_in,.hljs-builtin-name,.hljs-class{color:var(--hl-type)}
.hljs-meta,.hljs-meta .hljs-keyword{color:var(--hl-meta)}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:600}

/* ── rich editor (TipTap) ────────────────────────────────────────────── */
.ProseMirror{outline:none;min-height:55vh;caret-color:var(--grid-action);white-space:pre-wrap;word-wrap:break-word}
.ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:var(--grid-muted);float:left;height:0;pointer-events:none}
html[dir=rtl] .ProseMirror p.is-editor-empty:first-child::before{float:right}
.ProseMirror pre{white-space:pre}
html[data-wrap=on] .ProseMirror pre{white-space:pre-wrap}
.ProseMirror pre code{white-space:inherit}
.ProseMirror ul[data-type=taskList]{list-style:none;padding-inline-start:.1em}
.ProseMirror ul[data-type=taskList] li{display:flex;gap:.5em;align-items:flex-start;padding-inline-start:0}
.ProseMirror ul[data-type=taskList] li>label{flex:0 0 auto;margin-top:.12em;user-select:none;-webkit-user-select:none}
.ProseMirror ul[data-type=taskList] li>div{flex:1 1 auto;min-width:0}
.ProseMirror ul[data-type=taskList] li[data-checked=true]>div{color:var(--grid-muted);text-decoration:line-through}
.ProseMirror .tableWrapper{overflow-x:auto;margin:.8em 0;-webkit-overflow-scrolling:touch}
.ProseMirror table{min-width:100%;margin:0}
.ProseMirror td,.ProseMirror th{min-width:4em;position:relative}
.ProseMirror td>p,.ProseMirror th>p,.ProseMirror li>div>p,.ProseMirror li>p{margin:0}
.ProseMirror .selectedCell::after{content:"";position:absolute;inset:0;background:color-mix(in srgb,var(--grid-action) 18%,transparent);pointer-events:none}
.ProseMirror img.ProseMirror-selectednode{outline:2px solid var(--grid-action);outline-offset:2px}
.ProseMirror hr.ProseMirror-selectednode{border-top-color:var(--grid-action)}

/* ── plain markdown source (lossy notes) ─────────────────────────────── */
.zk-source{display:block;width:100%;min-height:60vh;border:0;outline:none;resize:none;background:transparent;color:var(--grid-fg);font-family:var(--zk-code-font);font-size:.88em;line-height:1.6;padding:0;margin:0;white-space:pre-wrap;unicode-bidi:plaintext;caret-color:var(--grid-action)}

/* ── lossy banner ────────────────────────────────────────────────────── */
.zk-banner{margin:0 0 14px;border:1px solid var(--grid-gold,#c9a227);background:var(--grid-soft);background:color-mix(in srgb,var(--grid-gold,#c9a227) 9%,var(--grid-bg));border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.5}
.zk-banner strong{display:block;font-weight:500;color:var(--grid-fg)}
.zk-banner p{margin:4px 0 0;color:var(--grid-muted)}
.zk-banner code{font-family:var(--zk-code-font);font-size:12px;color:var(--grid-fg)}
.zk-banner button{margin-top:10px;font:inherit;font-size:14px;border:1px solid var(--grid-line);background:var(--grid-bg);color:var(--grid-fg);border-radius:6px;padding:7px 12px}
.zk-banner button:active{background:var(--grid-soft)}

/* ── export capture ──────────────────────────────────────────────────── */
.zk-export-title{font-size:1.9em;font-weight:500;line-height:1.25;margin:0 0 .6em}
#zk-capture{position:absolute;top:0;left:0;width:720px;padding:32px 36px;background:var(--grid-bg);color:var(--grid-fg)}
`;
