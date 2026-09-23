import { renderMarkdown } from "@/lib/markdown";

import { bridge } from "../../lib/bridge";
import { MATH_TOKEN, MERMAID_TOKEN, type Prepared } from "./prepare";
import { loadKatex, loadMermaid } from "./vendor";

/*
Markdown extras, step 2 of 2: a DOM pass over what NoteMarkdown rendered from
the prepared source (prepare.ts). Idempotent — it only touches placeholders and
elements it has not marked yet — so it can simply re-run whenever the rendered
HTML changes (extended-markdown.tsx observes the container).

  math       ZKMATH* placeholders -> KaTeX (lazy); the TeX shows until it loads
  mermaid    ZKMERMAID* paragraphs -> a diagram figure (lazy) with Save SVG / PNG
  alerts     > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
  footnotes  [^id] -> superscript links + a Footnotes section at the end

Colours are the grid tokens (var(--grid-*)), set inline so the prose
styles' descendant selectors cannot override them; spacing is logical
(inline-start), so Arabic documents mirror correctly.
*/

export type EnhanceContext = {
  prepared: Prepared;
  dark: boolean;
  t: (key: "mdx.footnotes" | "mdx.backToText" | "mdx.diagram" | "mdx.diagramError" | "mdx.saveSvg" | "mdx.savePng" | `mdx.alert.${AlertKind}`) => string;
  onError?: (message: string) => void;
};

type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

const ALERT_COLOR: Record<AlertKind, string> = {
  note: "var(--grid-action)",
  tip: "var(--grid-ok)",
  important: "var(--grid-brand-accent, var(--grid-gold))",
  warning: "var(--grid-warn)",
  caution: "var(--grid-danger)",
};

// lucide-style glyphs, inline so the pass needs no React.
const ALERT_ICON: Record<AlertKind, string> = {
  note: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  tip: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  important: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  caution: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

const svgIcon = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Text nodes outside code/pre/katex, whose text matches `re`. */
function textNodes(root: Element, re: RegExp): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      re.lastIndex = 0;
      if (!node.textContent || !re.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
        if (/^(CODE|PRE|SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName) || p.classList.contains("katex")) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/* ----------------------------------------------------------------- math */

function applyMath(root: Element, ctx: EnhanceContext): void {
  const nodes = textNodes(root, new RegExp(MATH_TOKEN.source));
  if (!nodes.length) return;
  const pending: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(new RegExp(MATH_TOKEN.source, "g"))) {
      if (m.index! > last) frag.append(text.slice(last, m.index));
      const item = ctx.prepared.math[Number(m[2])];
      const el = document.createElement(m[1] === "D" ? "div" : "span");
      el.dataset.zkMath = String(m[2]);
      el.className = m[1] === "D" ? "zk-math-display my-3 overflow-x-auto text-center" : "zk-math";
      el.setAttribute("dir", "ltr");
      // Until KaTeX arrives (or if it fails): the TeX itself, as code.
      el.innerHTML = `<code>${esc(item ? (m[1] === "D" ? `$$${item.tex}$$` : `$${item.tex}$`) : m[0])}</code>`;
      frag.append(el);
      pending.push(el);
      last = m.index! + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    const parent = node.parentElement;
    node.replaceWith(frag);
    // A display block alone in its paragraph replaces the paragraph.
    if (parent?.tagName === "P" && parent.childNodes.length === 1 && parent.firstElementChild?.classList.contains("zk-math-display")) {
      parent.replaceWith(parent.firstElementChild);
    }
  }
  void loadKatex()
    .then((katex) => {
      for (const el of pending) {
        if (!el.isConnected) continue;
        const item = ctx.prepared.math[Number(el.dataset.zkMath)];
        if (!item) continue;
        el.innerHTML = katex.renderToString(item.tex, {
          displayMode: item.display,
          throwOnError: false,
          output: "htmlAndMathml",
          strict: "ignore",
        });
      }
    })
    .catch((e) => ctx.onError?.(String(e?.message ?? e)));
}

/* -------------------------------------------------------------- mermaid */

let seq = 0;
let chain: Promise<unknown> = Promise.resolve();
/** mermaid.render shares global state: one diagram at a time. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export async function svgToPng(svgEl: SVGSVGElement, dark: boolean): Promise<Uint8Array> {
  const vb = svgEl.viewBox?.baseVal;
  const rect = svgEl.getBoundingClientRect();
  const w = Math.ceil(vb?.width || rect.width || 800);
  const h = Math.ceil(vb?.height || rect.height || 600);
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const g = canvas.getContext("2d")!;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--grid-bg").trim() || (dark ? "#0B1429" : "#ffffff");
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encoding failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = "rounded-sm border border-line bg-grid-card px-2 py-0.5 text-[12.5px] text-grid-muted hover:text-grid-fg";
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

function applyMermaid(root: Element, ctx: EnhanceContext): void {
  const paras = Array.from(root.querySelectorAll("p")).filter((p) => MERMAID_TOKEN.test((p.textContent ?? "").trim()));
  // A theme change re-renders diagrams already drawn with the other theme.
  const stale = Array.from(root.querySelectorAll<HTMLElement>("figure[data-zk-mermaid]")).filter(
    (f) => f.dataset.zkTheme !== (ctx.dark ? "dark" : "light"),
  );
  if (!paras.length && !stale.length) return;

  const figures: HTMLElement[] = [...stale];
  for (const p of paras) {
    const idx = Number(MERMAID_TOKEN.exec((p.textContent ?? "").trim())![1]);
    const source = ctx.prepared.mermaid[idx] ?? "";
    const fig = document.createElement("figure");
    fig.dataset.zkMermaid = String(idx);
    fig.className = "zk-mermaid my-3 rounded-md border border-line bg-grid-card p-3";
    fig.setAttribute("dir", "ltr");
    fig.innerHTML = `<div data-zk-diagram class="flex justify-center overflow-x-auto"><pre class="text-xs text-grid-muted"><code>${esc(source)}</code></pre></div>`;
    p.replaceWith(fig);
    figures.push(fig);
  }

  for (const fig of figures) {
    fig.dataset.zkTheme = ctx.dark ? "dark" : "light";
    const idx = Number(fig.dataset.zkMermaid);
    const source = ctx.prepared.mermaid[idx] ?? "";
    void serial(async () => {
      const mermaid = await loadMermaid(ctx.dark);
      const { svg } = await mermaid.render(`zk-mermaid-${++seq}`, source);
      return svg;
    })
      .then((svg) => {
        if (!fig.isConnected) return;
        const host = fig.querySelector<HTMLElement>("[data-zk-diagram]")!;
        host.innerHTML = svg;
        const svgEl = host.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
        }
        fig.querySelector("[data-zk-diagram-bar]")?.remove();
        const bar = document.createElement("figcaption");
        bar.dataset.zkDiagramBar = "";
        bar.className = "mt-2 flex items-center justify-end gap-1.5";
        bar.append(
          button(ctx.t("mdx.saveSvg"), () => {
            void bridge()
              .saveFile({ suggestedName: `diagram-${idx + 1}.svg`, filters: [{ name: "SVG", extensions: ["svg"] }], text: svg })
              .catch((e) => ctx.onError?.(String(e?.message ?? e)));
          }),
          button(ctx.t("mdx.savePng"), () => {
            if (!svgEl) return;
            void svgToPng(svgEl, ctx.dark)
              .then((bytes) =>
                bridge().saveFile({ suggestedName: `diagram-${idx + 1}.png`, filters: [{ name: "PNG", extensions: ["png"] }], bytes }),
              )
              .catch((e) => ctx.onError?.(String(e?.message ?? e)));
          }),
        );
        fig.append(bar);
      })
      .catch((e) => {
        if (!fig.isConnected) return;
        const host = fig.querySelector<HTMLElement>("[data-zk-diagram]");
        if (!host) return;
        host.insertAdjacentHTML(
          "beforebegin",
          `<div class="mb-2 text-xs" style="color: var(--grid-danger)">${esc(ctx.t("mdx.diagramError"))}: ${esc(String(e?.message ?? e).split("\n")[0])}</div>`,
        );
      });
  }
}

/* --------------------------------------------------------------- alerts */

function applyAlerts(root: Element, ctx: EnhanceContext): void {
  for (const bq of Array.from(root.querySelectorAll<HTMLElement>("blockquote:not([data-zk-alert])"))) {
    const first = bq.querySelector("p");
    if (!first) continue;
    const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.textContent ?? "");
    if (!m) continue;
    const kind = m[1].toLowerCase() as AlertKind;
    const color = ALERT_COLOR[kind];
    bq.dataset.zkAlert = kind;
    bq.setAttribute(
      "style",
      `border-inline-start: 3px solid ${color}; background: color-mix(in oklab, ${color} 9%, transparent); color: var(--grid-fg); padding: 0.5rem 0.75rem; border-radius: 0.375rem;`,
    );
    // Drop the marker (and the line break marked leaves after it).
    const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
    const t = walker.nextNode() as Text | null;
    if (t) t.textContent = (t.textContent ?? "").replace(/^\s*\[![A-Za-z]+\]\s*/, "");
    if (first.firstElementChild?.tagName === "BR" && !(first.firstChild?.textContent ?? "").trim()) first.firstElementChild.remove();
    if (!(first.textContent ?? "").trim() && !first.querySelector("img")) first.remove();
    const head = document.createElement("div");
    head.className = "mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide";
    head.style.color = color;
    head.innerHTML = `${svgIcon(ALERT_ICON[kind])}<span>${esc(ctx.t(`mdx.alert.${kind}`))}</span>`;
    bq.prepend(head);
  }
}

/* ------------------------------------------------------------ footnotes */

function applyFootnotes(root: Element, ctx: EnhanceContext): void {
  const defs = ctx.prepared.footnotes;
  if (!defs.size || root.querySelector("[data-zk-footnotes]")) return;
  const order: string[] = [];
  const re = /\[\^([^\]\s]+)\]/g;
  for (const node of textNodes(root, /\[\^[^\]\s]+\]/)) {
    const text = node.textContent ?? "";
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      const id = m[1];
      if (!defs.has(id)) continue;
      if (m.index! > last) frag.append(text.slice(last, m.index));
      if (!order.includes(id)) order.push(id);
      const n = order.indexOf(id) + 1;
      const sup = document.createElement("sup");
      sup.innerHTML = `<a href="#zk-fn-${esc(id)}" id="zk-fnref-${esc(id)}" data-zk-fn="${esc(id)}" class="no-underline">${n}</a>`;
      frag.append(sup);
      last = m.index! + m[0].length;
    }
    if (last === 0) continue;
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  if (!order.length) return;
  const section = document.createElement("section");
  section.dataset.zkFootnotes = "";
  section.className = "mt-8 border-t border-line pt-3 text-xs text-grid-muted";
  const items = order
    .map((id) => {
      const html = renderMarkdown(defs.get(id) ?? "", { extractMermaid: false }).html.replace(/^\s*<p>([\s\S]*)<\/p>\s*$/, "$1");
      return `<li id="zk-fn-${esc(id)}">${html} <a href="#zk-fnref-${esc(id)}" data-zk-fnback="${esc(id)}" aria-label="${esc(ctx.t("mdx.backToText"))}" class="no-underline">↩</a></li>`;
    })
    .join("");
  section.innerHTML = `<div class="mb-2 font-medium text-grid-fg">${esc(ctx.t("mdx.footnotes"))}</div><ol>${items}</ol>`;
  root.append(section);
}

/** In-page footnote jumps without touching location.hash. */
function onFootnoteClick(e: Event): void {
  const a = (e.target as Element | null)?.closest?.("a[data-zk-fn], a[data-zk-fnback]") as HTMLAnchorElement | null;
  if (!a) return;
  const id = a.dataset.zkFn ? `zk-fn-${a.dataset.zkFn}` : `zk-fnref-${a.dataset.zkFnback}`;
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Run every extra over `root` (the rendered note body). Returns a cleanup for
 * the listeners it adds.
 */
export function enhance(root: Element, ctx: EnhanceContext): () => void {
  applyAlerts(root, ctx);
  applyFootnotes(root, ctx);
  applyMath(root, ctx);
  applyMermaid(root, ctx);
  root.addEventListener("click", onFootnoteClick);
  return () => root.removeEventListener("click", onFootnoteClick);
}
