import type { MarkedExtension, Tokens } from 'marked';

/*
Markdown tables, rendered as an interactive data view rather than a bare
<table>: a filter box, a live row count, sortable headers and an export menu
(Copy as Markdown, PNG, CSV, XLSX, JSON).

Same approach as code-block.ts — emit plain HTML that survives DOMPurify and
let the React layer delegate behaviour from one listener, rather than mounting
a React root per table.

The original cell text is carried on the element as JSON in data-rows. Filter,
sort and every export read from that rather than scraping the DOM, so inline
markup (<code>, <strong>, links) never leaks into a CSV cell and a sort never
compares rendered HTML.
*/

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Strip inline markdown to the plain text a spreadsheet cell should hold. */
export function plainCell(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // images -> alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links -> label
    .replace(/`([^`]*)`/g, '$1')                // inline code
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    // Raw HTML in a cell is rendered away for display, so the exported text
    // must not still carry the tags — a CSV cell showing "<img src=x>" while
    // the table shows an image is just wrong data.
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const tableExtension: MarkedExtension = {
  renderer: {
    table(token: Tokens.Table) {
      const headers = token.header.map((c) => plainCell(c.text));
      const aligns = token.align ?? [];
      const rows = token.rows.map((r) => r.map((c) => plainCell(c.text)));

      // Cells DISPLAY their rendered inline markup — a table cell must still
      // show **bold**, `code` and links — while data-rows carries the plain
      // text that filter, sort and every export use. Rendering the plain text
      // instead would silently strip markup from every table in the app.
      const inline = (c: Tokens.TableCell) =>
        c.tokens ? this.parser.parseInline(c.tokens) : escapeHtml(c.text);

      const head = token.header
        .map((c, i) => {
          const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
          return `<th${align} data-col="${i}"><button type="button" class="zk-table-sort" data-zk-table-sort="${i}">${inline(
            c,
          )}<span class="zk-sort-caret" aria-hidden="true"></span></button></th>`;
        })
        .join('');

      const body = token.rows
        .map((r) => {
          const cells = r
            .map((c, i) => {
              const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
              return `<td${align}>${inline(c)}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');

      const payload = escapeHtml(JSON.stringify({ headers, rows }));

      return [
        `<figure class="zk-table" data-rows="${payload}">`,
        `<figcaption class="zk-table-bar">`,
        `<span class="zk-table-filter">`,
        `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`,
        `<input type="text" placeholder="Filter…" data-zk-table-filter aria-label="Filter rows" />`,
        `</span>`,
        `<span class="zk-table-count" data-zk-table-count>${token.rows.length} ${token.rows.length === 1 ? 'row' : 'rows'}</span>`,
        `<button type="button" class="zk-table-menu" data-zk-table-menu aria-label="Table actions" aria-haspopup="menu">`,
        `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
        `</button>`,
        `</figcaption>`,
        `<div class="zk-table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
        `</figure>`,
      ].join('');
    },
  },
};

export const TABLE_ATTRS = [
  'data-rows',
  'data-col',
  'data-zk-table-sort',
  'data-zk-table-filter',
  'data-zk-table-count',
  'data-zk-table-menu',
  'placeholder',
  'type',
  'style',
];
