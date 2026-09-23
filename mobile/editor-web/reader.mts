import { renderMarkdown } from "../../web/lib/markdown/renderer.ts";
import { post } from "./bridge.mts";
import { hydrateImages } from "./images.mts";

/*
The rendered (read) view — web's own pipeline (lib/markdown/renderer.ts:
marked + code-block chrome + highlight.js + interactive tables + DOMPurify),
so inline HTML such as <details>, <kbd>, <sub> renders exactly as on web.

Used for read-only brains and for notes the rich editor cannot round-trip.
*/

/** Blocks that get dir="auto", so each paragraph of a mixed Arabic/English
 *  note aligns by its own first strong character, as on web. */
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,summary,td,th,ul,ol,table";

export interface ReaderLabels {
  rows: string;
  filter: string;
}

let labels: ReaderLabels = { rows: "rows", filter: "Filter…" };

export function setReaderLabels(next: ReaderLabels): void {
  labels = next;
}

/**
 * Markdown -> a DocumentFragment ready to insert. Parsed through a <template>
 * so nothing loads while it is being prepared: image sources move to
 * data-zk-src before any <img> reaches the live document, which is what stops
 * an unauthenticated request for every note image.
 */
export function renderFragment(markdown: string): DocumentFragment {
  const { html } = renderMarkdown(markdown ?? "", { extractMermaid: false });
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const frag = tpl.content;
  frag.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    img.removeAttribute("src");
    img.setAttribute("data-zk-src", src);
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
  });
  frag.querySelectorAll(BLOCKS).forEach((el) => {
    if (!el.hasAttribute("dir")) el.setAttribute("dir", "auto");
  });
  // web's table chrome is English; relabel it in the note's UI language.
  frag.querySelectorAll<HTMLElement>(".zk-table").forEach((figure) => {
    figure.querySelector("[data-zk-table-filter]")?.setAttribute("placeholder", labels.filter);
    const count = figure.querySelector("[data-zk-table-count]");
    if (count) count.textContent = `${figure.querySelectorAll("tbody > tr").length} ${labels.rows}`;
  });
  // Links always leave through RN; never navigate the page itself.
  frag.querySelectorAll("a[href]").forEach((a) => a.setAttribute("rel", "noopener noreferrer"));
  return frag;
}

export function renderInto(el: HTMLElement, markdown: string, lineNumbers: boolean): Promise<void> {
  el.replaceChildren(renderFragment(markdown));
  applyLineNumbers(el, lineNumbers);
  return hydrateImages(el);
}

// ─── Code blocks ────────────────────────────────────────────────────────────

/** Port of web code-actions toggleLineNumbers: a gutter column counted from
 *  the ORIGINAL source (highlight spans can cross newlines). */
function setGutter(figure: HTMLElement, on: boolean): void {
  const pre = figure.querySelector("pre");
  const code = figure.querySelector("code");
  if (!pre || !code) return;
  const has = figure.getAttribute("data-lines") === "on";
  if (has === on) return;
  if (!on) {
    figure.removeAttribute("data-lines");
    pre.querySelector(".zk-gutter")?.remove();
    return;
  }
  const lines = (code.getAttribute("data-code") ?? "").split("\n").length;
  const gutter = document.createElement("span");
  gutter.className = "zk-gutter";
  gutter.setAttribute("aria-hidden", "true");
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  pre.insertBefore(gutter, code);
  figure.setAttribute("data-lines", "on");
}

export function applyLineNumbers(root: ParentNode, on: boolean): void {
  root.querySelectorAll<HTMLElement>(".zk-code").forEach((figure) => setGutter(figure, on));
}

// ─── Tables (port of web table-actions: filter + sort from data-rows) ──────

interface TableData {
  headers: string[];
  rows: string[][];
}

function tableData(figure: HTMLElement): TableData {
  try {
    const parsed = JSON.parse(figure.getAttribute("data-rows") ?? "") as TableData;
    return { headers: parsed.headers ?? [], rows: parsed.rows ?? [] };
  } catch {
    return { headers: [], rows: [] };
  }
}

/** Body rows tagged with their index into data-rows, once. */
function bodyRows(figure: HTMLElement): HTMLTableRowElement[] {
  const rows = Array.from(figure.querySelectorAll<HTMLTableRowElement>("tbody > tr"));
  if (rows.length && !rows[0].hasAttribute("data-i")) rows.forEach((tr, i) => tr.setAttribute("data-i", String(i)));
  return rows;
}

function filterTable(figure: HTMLElement, query: string): void {
  const data = tableData(figure);
  const q = query.trim().toLowerCase();
  let shown = 0;
  for (const tr of bodyRows(figure)) {
    const row = data.rows[Number(tr.getAttribute("data-i"))] ?? [];
    const match = !q || row.join(" ").toLowerCase().includes(q);
    tr.hidden = !match;
    if (match) shown += 1;
  }
  const count = figure.querySelector("[data-zk-table-count]");
  if (count) count.textContent = `${shown} ${labels.rows}`;
}

const numeric = (s: string) => /^-?[\d,]*\.?\d+%?$/.test(s.trim());
const asNumber = (s: string) => parseFloat(s.replace(/[,%]/g, ""));

function sortTable(figure: HTMLElement, button: HTMLElement): void {
  const col = Number(button.getAttribute("data-zk-table-sort"));
  const next = button.getAttribute("data-active") === "asc" ? "desc" : button.getAttribute("data-active") === "desc" ? "" : "asc";
  figure.querySelectorAll("[data-zk-table-sort]").forEach((b) => b.removeAttribute("data-active"));
  if (next) button.setAttribute("data-active", next);
  const data = tableData(figure);
  const rows = bodyRows(figure);
  const cell = (tr: HTMLTableRowElement) => data.rows[Number(tr.getAttribute("data-i"))]?.[col] ?? "";
  const sorted = [...rows].sort((a, b) => {
    if (!next) return Number(a.getAttribute("data-i")) - Number(b.getAttribute("data-i"));
    const x = cell(a);
    const y = cell(b);
    const cmp = numeric(x) && numeric(y) ? asNumber(x) - asNumber(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
    return next === "asc" ? cmp : -cmp;
  });
  const tbody = figure.querySelector("tbody");
  if (tbody) for (const tr of sorted) tbody.appendChild(tr);
}

function tableMarkdown(data: TableData): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const line = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  return [line(data.headers), `|${data.headers.map(() => " --- ").join("|")}|`, ...data.rows.map(line)].join("\n");
}

// ─── Delegated behaviour (installed once per root) ─────────────────────────

export function installReaderBehaviour(root: HTMLElement): void {
  if (root.dataset.zkBehaviour) return;
  root.dataset.zkBehaviour = "1";

  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const codeMenu = target.closest<HTMLElement>("[data-zk-code-menu]");
    if (codeMenu) {
      e.preventDefault();
      const code = codeMenu.closest(".zk-code")?.querySelector("code")?.getAttribute("data-code") ?? "";
      post({ type: "copy", text: code });
      return;
    }

    const sort = target.closest<HTMLElement>("[data-zk-table-sort]");
    if (sort) {
      e.preventDefault();
      const figure = sort.closest<HTMLElement>(".zk-table");
      if (figure) sortTable(figure, sort);
      return;
    }

    const tableMenu = target.closest<HTMLElement>("[data-zk-table-menu]");
    if (tableMenu) {
      e.preventDefault();
      const figure = tableMenu.closest<HTMLElement>(".zk-table");
      if (figure) post({ type: "copy", text: tableMarkdown(tableData(figure)) });
      return;
    }

    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      e.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
      } else if (href) {
        post({ type: "link", href });
      }
    }
  });

  root.addEventListener("input", (e) => {
    const input = (e.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-zk-table-filter]");
    const figure = input?.closest<HTMLElement>(".zk-table");
    if (input && figure) filterTable(figure, input.value);
  });
}
