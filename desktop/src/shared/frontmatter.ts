// YAML frontmatter, the small subset notes actually use. Pure (no node, no
// DOM), so the main-process importers (markdown folder, Notion) and the
// renderer's markdown extras (the frontmatter panel) share one parser.
//
// Supported:
//   ---
//   title: "My Page"            scalars: strings (bare / "…" / '…'), numbers,
//   draft: true                          booleans, null/~
//   tags: [a, b, "c d"]         inline lists
//   aliases:                    block lists
//     - one
//     - "two"
//   ---
//
// Anything richer (nested maps, multi-line scalars, anchors) is kept as its raw
// text rather than guessed at. A block that is not closed by `---` / `...` is
// not frontmatter: the document is returned untouched.

export type FrontmatterValue = string | number | boolean | null | string[];

export interface FrontmatterResult {
  /** Parsed keys in source order. Empty when there is no block. */
  data: Record<string, FrontmatterValue>;
  /** The document without the block (and without the blank line after it). */
  body: string;
  /** True when a closed `---` block was found at the very top. */
  found: boolean;
  /** The raw YAML between the fences ("" when not found). */
  raw: string;
}

export function parseFrontmatter(source: string): FrontmatterResult {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const none: FrontmatterResult = { data: {}, body: source, found: false, raw: "" };
  const lines = text.split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== "---") return none;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === "---" || l === "...") {
      end = i;
      break;
    }
  }
  if (end < 0) return none;

  const yamlLines = lines.slice(1, end);
  const data: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;

  for (const line of yamlLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? (listKey ? /^-\s*(.*)$/.exec(line) : null);
    if (item && listKey) {
      const current = data[listKey];
      const arr = Array.isArray(current) ? current : [];
      const v = unquote(item[1].trim());
      if (v) arr.push(v);
      data[listKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z0-9_][\w .-]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
    if (!kv) {
      listKey = null;
      continue;
    }
    const key = kv[1].trim();
    const rawValue = (kv[2] ?? "").trim();
    if (rawValue === "") {
      // `key:` followed by an indented block list (or nothing).
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    data[key] = parseScalar(rawValue);
  }

  // A `key:` that never received list items is an empty value, not a list.
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v) && v.length === 0) data[k] = null;

  const rest = lines.slice(end + 1);
  if (rest.length && rest[0].trim() === "") rest.shift();
  return { data, body: rest.join("\n"), found: true, raw: yamlLines.join("\n") };
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    const inner = s.slice(1, -1);
    return s.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  // Trailing comment on a bare scalar: `value # note`.
  return s.replace(/\s+#.*$/, "");
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw.startsWith("[") && raw.endsWith("]")) return splitInlineList(raw.slice(1, -1));
  const v = unquote(raw);
  if (v !== raw) return v; // was quoted: keep as a string
  if (v === "true" || v === "True" || v === "yes") return true;
  if (v === "false" || v === "False" || v === "no") return false;
  if (v === "null" || v === "~" || v === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function splitInlineList(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ",") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Tags from a frontmatter map: `tags` / `tag` / `keywords`, as a list or a
 *  comma/space separated string; `#` prefixes dropped, de-duplicated. */
export function frontmatterTags(data: Record<string, FrontmatterValue>): string[] {
  const out: string[] = [];
  for (const key of ["tags", "tag", "keywords"]) {
    const v = data[key];
    const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
    for (const t of items) {
      const clean = String(t).trim().replace(/^#/, "");
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

/** A frontmatter value as display text (lists joined with ", "). */
export function frontmatterText(v: FrontmatterValue): string {
  if (v === null) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}
