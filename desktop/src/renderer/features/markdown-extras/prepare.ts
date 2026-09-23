import { parseFrontmatter, type FrontmatterValue } from "../../../shared/frontmatter";

/*
Markdown extras, step 1 of 2: a SOURCE pass that runs before the web
renderer (web/lib/markdown via NoteMarkdown), for the constructs marked would
otherwise mangle or not know about. Pure, no DOM.

  frontmatter   stripped, returned as data for the Properties panel
  ```mermaid    replaced by a placeholder paragraph ZKMERMAID<n>ZK
  $$…$$ / $…$   replaced by placeholders ZKMATHD<n>ZK / ZKMATHI<n>ZK — marked
                would otherwise eat `_` and `\\` inside the TeX
  [^id]: text   footnote definitions pulled out (the [^id] references stay in
                the text and are linked in the DOM pass)

Fenced code and inline code spans are left untouched, so `$HOME` in a code
block is never math. Placeholders are plain alphanumerics so neither marked
nor DOMPurify can alter them; step 2 (enhance.ts) swaps them in the DOM.
*/

export type MathItem = { tex: string; display: boolean };

export type Prepared = {
  body: string;
  frontmatter: Record<string, FrontmatterValue> | null;
  math: MathItem[];
  mermaid: string[];
  footnotes: Map<string, string>;
};

export const MATH_TOKEN = /ZKMATH([DI])(\d+)ZK/g;
export const MERMAID_TOKEN = /^ZKMERMAID(\d+)ZK$/;

type Segment = { code: boolean; text: string; lang?: string };

/** Split into fenced-code and prose segments (``` and ~~~ fences, CommonMark rules). */
export function splitFences(src: string): Segment[] {
  const lines = src.split("\n");
  const out: Segment[] = [];
  let prose: string[] = [];
  let i = 0;
  const flushProse = () => {
    if (prose.length) out.push({ code: false, text: prose.join("\n") });
    prose = [];
  };
  while (i < lines.length) {
    const open = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/.exec(lines[i]);
    if (!open) {
      prose.push(lines[i++]);
      continue;
    }
    flushProse();
    const fence = open[2];
    const block = [lines[i++]];
    while (i < lines.length) {
      const l = lines[i++];
      block.push(l);
      if (new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(l)) break;
    }
    out.push({ code: true, text: block.join("\n"), lang: open[3].toLowerCase() });
  }
  flushProse();
  return out;
}

/** Replace math in prose, skipping inline code spans and escaped dollars. */
export function extractMath(text: string, math: MathItem[]): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "`") {
      let n = 0;
      while (text[i + n] === "`") n++;
      const ticks = "`".repeat(n);
      const end = text.indexOf(ticks, i + n);
      if (end > 0) {
        out += text.slice(i, end + n);
        i = end + n;
        continue;
      }
      out += ticks;
      i += n;
      continue;
    }
    if (c === "$" && text[i + 1] === "$") {
      const end = text.indexOf("$$", i + 2);
      if (end > i + 2) {
        const tex = text.slice(i + 2, end).trim();
        const idx = math.push({ tex, display: true }) - 1;
        const atLineStart = i === 0 || text[i - 1] === "\n";
        const token = `ZKMATHD${idx}ZK`;
        out += atLineStart ? `\n${token}\n` : token;
        i = end + 2;
        continue;
      }
    }
    if (c === "$") {
      // Pandoc's rule: no space after the opening $, none before the closing
      // one, and no digit right after it — so "$5 and $10" stays money.
      const next = text[i + 1];
      if (next && next !== " " && next !== "\n" && next !== "$") {
        let j = i + 1;
        while (j < text.length && text[j] !== "\n") {
          if (text[j] === "\\") {
            j += 2;
            continue;
          }
          if (text[j] === "$") break;
          j++;
        }
        if (text[j] === "$" && text[j - 1] !== " " && !/\d/.test(text[j + 1] ?? "")) {
          const idx = math.push({ tex: text.slice(i + 1, j), display: false }) - 1;
          out += `ZKMATHI${idx}ZK`;
          i = j + 1;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Pull `[^id]: text` definitions (with indented continuation lines) out of prose. */
export function extractFootnotes(text: string, into: Map<string, string>): string {
  const keep: string[] = [];
  let current: { id: string; lines: string[] } | null = null;
  const close = () => {
    if (current) into.set(current.id, current.lines.join("\n").trim());
    current = null;
  };
  for (const line of text.split("\n")) {
    const def = /^ {0,3}\[\^([^\]\s]+)\]:\s?(.*)$/.exec(line);
    if (def) {
      close();
      current = { id: def[1], lines: [def[2]] };
      continue;
    }
    if (current && (/^( {2,}|\t)\S/.test(line) || (line.trim() === "" && current.lines.length === 0))) {
      current.lines.push(line.trim());
      continue;
    }
    close();
    keep.push(line);
  }
  close();
  return keep.join("\n");
}

export function prepareMarkdown(source: string, opts: { frontmatter?: boolean } = {}): Prepared {
  let src = (source ?? "").replace(/\r\n/g, "\n");
  let frontmatter: Prepared["frontmatter"] = null;
  if (opts.frontmatter !== false) {
    const fm = parseFrontmatter(src);
    if (fm.found) {
      src = fm.body;
      frontmatter = fm.data;
    }
  }
  const math: MathItem[] = [];
  const mermaid: string[] = [];
  const footnotes = new Map<string, string>();
  const parts = splitFences(src).map((seg) => {
    if (seg.code) {
      if (seg.lang !== "mermaid") return seg.text;
      const inner = seg.text.split("\n").slice(1);
      if (inner.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(inner[inner.length - 1])) inner.pop();
      const idx = mermaid.push(inner.join("\n")) - 1;
      return `\nZKMERMAID${idx}ZK\n`;
    }
    return extractMath(extractFootnotes(seg.text, footnotes), math);
  });
  return { body: parts.join("\n"), frontmatter, math, mermaid, footnotes };
}

/** Cheap check: does this text need the extras at all? */
export function needsExtras(source: string): boolean {
  return /\$|```\s*mermaid|~~~\s*mermaid|\[\^|\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|^---\s*$/im.test(source ?? "");
}
