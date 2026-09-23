// HTML -> Markdown for imported note bodies (Apple Notes emits HTML; so do
// some Keep/Notion edge cases). Pure: no DOM, no node APIs, unit-tested in
// test/importers.test.cjs.
//
// Mark It Down used a chain of regexes, which broke on nesting (a list inside
// a list, bold inside a link) and on Apple Notes' one-<div>-per-line layout.
// This is a small tolerant parser instead: tokenize -> tree (with the usual
// implied closes) -> serialize. It covers what notes contain:
//   headings, paragraphs, Apple Notes <div> lines (joined with hard breaks,
//   an empty <div><br></div> ends the paragraph), bold/italic/strike (tags or
//   inline style), links, inline code, <pre> code blocks, nested ul/ol and
//   checklists, blockquotes, hr, tables (GFM), images (handed to a callback so
//   the caller can turn data: URLs into uploads).
// Unknown elements keep their text. <script>/<style>/<head> are dropped.

export interface HtmlToMdOptions {
  /** Called for every <img>. Return the markdown to emit, or null to drop it.
   *  Default: `![alt](src)` for http(s) sources, dropped otherwise. */
  image?: (src: string, alt: string) => string | null;
}

type El = { kind: "el"; tag: string; attrs: Record<string, string>; children: Node[] };
type Text = { kind: "text"; text: string };
type Node = El | Text;

const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "col", "area", "base", "embed", "source", "wbr", "param", "track"]);
const DROP = new Set(["script", "style", "head", "title", "template", "noscript", "iframe", "svg", "math", "button", "select", "textarea"]);
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav", "figure", "figcaption", "body", "html",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "pre", "blockquote", "hr", "table", "thead", "tbody", "tfoot",
  "tr", "td", "th", "dl", "dt", "dd", "address", "details", "summary", "object", "center", "form", "fieldset",
]);

/* ------------------------------------------------------------ entities */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•",
  middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", times: "×", divide: "÷", laquo: "«", raquo: "»",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", shy: "", zwj: "‍", zwnj: "‌",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", check: "✓",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      return code === 160 ? " " : String.fromCodePoint(code);
    }
    const v = NAMED[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/* -------------------------------------------------------------- parser */

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

export function parseHtml(html: string): El {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<(script|style|head|title|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  const root: El = { kind: "el", tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (tag: string) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) {
        stack.length = i;
        return true;
      }
    }
    return false;
  };
  const re = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    if (m.index > last) top().children.push({ kind: "text", text: cleaned.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    if (m[0][1] === "/") {
      // Stray end tags (no matching open element) are ignored.
      closeTo(tag);
      continue;
    }
    // Implied end tags.
    if (tag === "li") {
      const listIdx = findLast(stack, (e) => e.tag === "ul" || e.tag === "ol");
      const liIdx = findLast(stack, (e) => e.tag === "li");
      if (liIdx > listIdx && liIdx > 0) stack.length = liIdx;
    } else if (tag === "tr") {
      const tIdx = findLast(stack, (e) => e.tag === "table");
      const trIdx = findLast(stack, (e) => e.tag === "tr");
      if (trIdx > tIdx && trIdx > 0) stack.length = trIdx;
    } else if (tag === "td" || tag === "th") {
      const trIdx = findLast(stack, (e) => e.tag === "tr");
      const cIdx = findLast(stack, (e) => e.tag === "td" || e.tag === "th");
      if (cIdx > trIdx && cIdx > 0) stack.length = cIdx;
    } else if (BLOCK.has(tag) && top().tag === "p") {
      stack.pop();
    }
    const el: El = { kind: "el", tag, attrs: parseAttrs(m[2] ?? ""), children: [] };
    top().children.push(el);
    if (!VOID.has(tag) && !m[0].endsWith("/>")) stack.push(el);
  }
  if (last < cleaned.length) top().children.push({ kind: "text", text: cleaned.slice(last) });
  return root;
}

function findLast<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

/* ---------------------------------------------------------- serializer */

const isBlockEl = (n: Node): n is El => n.kind === "el" && BLOCK.has(n.tag);

function textContent(n: Node): string {
  if (n.kind === "text") return decodeEntities(n.text);
  if (n.tag === "br") return "\n";
  if (DROP.has(n.tag)) return "";
  return n.children.map(textContent).join("");
}

/** Escape markdown syntax in plain text without littering ordinary prose. */
export function escapeMarkdownText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/([*`])/g, "\\$1")
    .replace(/(^|[^A-Za-z0-9])_|_(?=$|[^A-Za-z0-9])/g, (m) => m.replace("_", "\\_"))
    .replace(/\[([^\]]*)\](?=[(:[])/g, "\\[$1\\]")
    .replace(/<(?=[A-Za-z/!])/g, "&lt;");
}

/** Line-start characters that would turn a paragraph into another block. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)>/, "$1\\>")
    .replace(/^(\s*)([-+])(?=\s)/, "$1\\$2")
    .replace(/^(\s*)(\d+)([.)])(?=\s)/, "$1$2\\$3")
    .replace(/^(\s*)(={3,}|-{3,})\s*$/, "$1\\$2");
}

type Style = { bold?: boolean; italic?: boolean; strike?: boolean };

function styleOf(el: El): Style {
  const css = (el.attrs.style ?? "").toLowerCase();
  const s: Style = {};
  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(css)) s.bold = true;
  if (/font-style\s*:\s*italic/.test(css)) s.italic = true;
  if (/text-decoration[^;]*line-through/.test(css)) s.strike = true;
  return s;
}

/** Wrap `inner` in a marker, keeping edge whitespace outside it
 *  (`** x **` is not bold in CommonMark). */
function wrap(inner: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!m[2]) return inner;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

class Serializer {
  constructor(private opts: HtmlToMdOptions) {}

  /* inline */

  inline(nodes: Node[]): string {
    return nodes.map((n) => this.inlineNode(n)).join("");
  }

  private inlineNode(n: Node): string {
    if (n.kind === "text") return escapeMarkdownText(decodeEntities(n.text).replace(/\s+/g, " "));
    if (DROP.has(n.tag)) return "";
    switch (n.tag) {
      case "br":
        return "\n";
      case "b":
      case "strong":
        return wrap(this.inline(n.children), "**");
      case "i":
      case "em":
      case "cite":
      case "var":
        return wrap(this.inline(n.children), "*");
      case "s":
      case "strike":
      case "del":
        return wrap(this.inline(n.children), "~~");
      case "code":
      case "kbd":
      case "samp":
      case "tt": {
        const text = textContent(n).replace(/\s+/g, " ");
        if (!text.trim()) return text;
        const ticks = "`".repeat(longestRun(text, "`") + 1);
        const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
        return `${ticks}${pad}${text}${pad}${ticks}`;
      }
      case "a": {
        const href = (n.attrs.href ?? "").trim();
        const label = this.inline(n.children).replace(/\n+/g, " ");
        if (!href || /^(javascript|vbscript|data):/i.test(href)) return label;
        const text = label.trim();
        if (!text) return "";
        if (text === href || text === escapeMarkdownText(href)) return `<${href}>`;
        return `[${text}](${href.replace(/[ ()]/g, (c) => encodeURIComponent(c))})`;
      }
      case "img": {
        const src = n.attrs.src ?? "";
        const alt = (n.attrs.alt ?? n.attrs.title ?? "").replace(/[\[\]]/g, "");
        if (this.opts.image) return this.opts.image(src, alt) ?? "";
        return /^https?:/i.test(src) ? `![${alt}](${src})` : "";
      }
      case "input":
        return "";
      default: {
        const inner = this.inline(n.children);
        const st = styleOf(n);
        let out = inner;
        if (st.bold) out = wrap(out, "**");
        if (st.italic) out = wrap(out, "*");
        if (st.strike) out = wrap(out, "~~");
        return out;
      }
    }
  }

  /** Inline nodes -> lines of a paragraph (a <br> is a hard break). */
  private inlineLines(nodes: Node[]): string[] {
    return this.inline(nodes)
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .map(escapeLineStart);
  }

  /* blocks */

  blocks(nodes: Node[]): string[] {
    const out: string[] = [];
    let para: string[] = [];
    let inl: Node[] = [];

    const flushInline = () => {
      if (!inl.length) return;
      const lines = this.inlineLines(inl);
      inl = [];
      // A trailing <br> is not an empty line.
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      for (const l of lines) {
        if (l) para.push(l);
        else endPara();
      }
    };
    const endPara = () => {
      if (para.length) out.push(para.join("  \n"));
      para = [];
    };

    for (const n of nodes) {
      if (!isBlockEl(n)) {
        inl.push(n);
        continue;
      }
      flushInline();
      const onlyInline = n.children.every((c) => !isBlockEl(c));
      if (n.tag === "div" && onlyInline) {
        // Apple Notes: one <div> per line; an empty one separates paragraphs.
        const lines = this.inlineLines(n.children);
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        if (!lines.some(Boolean)) {
          endPara();
          continue;
        }
        for (const l of lines) {
          if (l) para.push(l);
          else endPara();
        }
        continue;
      }
      endPara();
      out.push(...this.block(n));
    }
    flushInline();
    endPara();
    return out.filter((b) => b.trim() !== "");
  }

  private block(n: El): string[] {
    switch (n.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = this.inline(n.children).replace(/\s+/g, " ").trim();
        return text ? [`${"#".repeat(Number(n.tag[1]))} ${text}`] : [];
      }
      case "p":
        return this.blocks(n.children);
      case "hr":
        return ["---"];
      case "pre": {
        const code = n.children.find((c): c is El => c.kind === "el" && c.tag === "code");
        const lang = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(code?.attrs.class ?? n.attrs.class ?? "")?.[1] ?? "";
        const text = textContent(n).replace(/\n$/, "");
        const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
        return [`${fence}${lang}\n${text}\n${fence}`];
      }
      case "blockquote": {
        const inner = this.blocks(n.children).join("\n\n");
        return inner ? [inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")] : [];
      }
      case "ul":
      case "ol":
        return [this.list(n, 0)].filter(Boolean);
      case "table":
        return [this.table(n)].filter(Boolean);
      case "dl": {
        const out: string[] = [];
        for (const c of n.children) {
          if (c.kind !== "el") continue;
          const text = this.inline(c.children).replace(/\s+/g, " ").trim();
          if (!text) continue;
          out.push(c.tag === "dt" ? `**${text}**` : text);
        }
        return out;
      }
      default:
        // Containers (div with block children, section, figure, object, li
        // outside a list, td outside a table …): their children.
        return this.blocks(n.children);
    }
  }

  private list(n: El, depth: number): string {
    const ordered = n.tag === "ol";
    let num = Number.parseInt(n.attrs.start ?? "1", 10);
    if (!Number.isFinite(num)) num = 1;
    const checklist = /checklist/i.test(n.attrs.class ?? "");
    const items: string[] = [];
    for (const c of n.children) {
      if (c.kind === "text") {
        if (c.text.trim()) items.push(`${ordered ? `${num++}.` : "-"} ${escapeMarkdownText(decodeEntities(c.text).trim())}`);
        continue;
      }
      if (c.tag === "ul" || c.tag === "ol") {
        // Apple Notes nests a list directly in a list: it belongs to the
        // previous item.
        const nested = this.list(c, depth + 1);
        if (!nested) continue;
        const indent = items.length ? " ".repeat(markerWidth(items[items.length - 1])) : "  ";
        const block = nested.split("\n").map((l) => (l ? indent + l : l)).join("\n");
        if (items.length) items[items.length - 1] += "\n" + block;
        else items.push(block);
        continue;
      }
      const marker = ordered ? `${num++}.` : "-";
      const checkbox = findCheckbox(c);
      const checked =
        checkbox ? checkbox.attrs.checked !== undefined : /(^|\s)(checked|done)(\s|$)/i.test(c.attrs.class ?? "") ? true : checklist ? false : null;
      const task = checked === null ? "" : checked ? "[x] " : "[ ] ";
      const inner = c.tag === "li" ? this.blocks(c.children) : this.block(c);
      const body = inner.join("\n");
      const prefix = `${marker} ${task}`;
      const indent = " ".repeat(marker.length + 1);
      const lines = (body || "").split("\n");
      items.push(prefix + lines[0] + (lines.length > 1 ? "\n" + lines.slice(1).map((l) => (l ? indent + l : l)).join("\n") : ""));
    }
    return items.filter((i) => i.trim()).join("\n");
  }

  private table(n: El): string {
    const rows: string[][] = [];
    let headerRow = false;
    const visit = (el: El, inHead: boolean) => {
      for (const c of el.children) {
        if (c.kind !== "el") continue;
        if (c.tag === "tr") {
          const cells = c.children
            .filter((x): x is El => x.kind === "el" && (x.tag === "td" || x.tag === "th"))
            .map((cell) =>
              this.blocks(cell.children)
                .join(" ")
                .replace(/\s*\n\s*/g, " ")
                .replace(/\|/g, "\\|")
                .trim(),
            );
          if (rows.length === 0 && (inHead || c.children.some((x) => x.kind === "el" && x.tag === "th"))) headerRow = true;
          rows.push(cells);
        } else if (c.tag === "thead") visit(c, true);
        else if (c.tag === "tbody" || c.tag === "tfoot") visit(c, false);
      }
    };
    visit(n, false);
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!width || !rows.length) return "";
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
    const header = headerRow ? pad(rows.shift()!) : Array(width).fill("");
    const line = (r: string[]) => `| ${r.join(" | ")} |`;
    return [line(header), line(Array(width).fill("---")), ...rows.map((r) => line(pad(r)))].join("\n");
  }
}

function findCheckbox(el: El): El | null {
  for (const c of el.children) {
    if (c.kind !== "el") continue;
    if (c.tag === "input" && (c.attrs.type ?? "").toLowerCase() === "checkbox") return c;
    if (c.tag === "ul" || c.tag === "ol") continue;
    const inner = findCheckbox(c);
    if (inner) return inner;
  }
  return null;
}

function markerWidth(item: string): number {
  const m = /^(\d+[.)]|[-*+])\s/.exec(item);
  return m ? m[1].length + 1 : 2;
}

function longestRun(s: string, ch: string): number {
  let best = 0;
  let cur = 0;
  for (const c of s) {
    cur = c === ch ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

export function htmlToMarkdown(html: string, opts: HtmlToMdOptions = {}): string {
  if (!html || !html.trim()) return "";
  const root = parseHtml(html);
  const md = new Serializer(opts).blocks(root.children).join("\n\n");
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

/** `#hashtags` in a note's text (Apple Notes keeps tags inline). */
export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? ""))) {
    if (/^\d+$/.test(m[1])) continue; // "#1" is a number, not a tag
    out.add(m[1].toLowerCase());
  }
  return [...out];
}
