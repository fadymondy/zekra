/*
Markdown block parsing for the mobile renderer.

Split out of markdown-view.tsx so it can be tested: the renderer is .tsx and
node's type-stripping does not handle JSX, so a pure .ts module is what the
test runner can actually import. It is also the right shape — the web keeps its
graph projection in lib/graph/tree.ts for the same reason.

Covers the subset notes actually use: headings, blockquotes, rules, fenced
code, lists and GFM pipe tables.
*/

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "code"; lines: string[]; lang: string; label: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "paragraph"; text: string };

/*
A GFM pipe table (MH-319).

Without this a table rendered as a run of paragraphs full of literal "|", which
is worse than not supporting tables at all — the note looks broken rather than
plain. Recognition needs TWO lines, a header and a delimiter (|---|:--:|), so a
paragraph that merely contains a pipe is not mistaken for one.

Deliberately not ported from web: filter, sort and multi-format export. Those
are a pointer affordance on a wide screen; here the table only has to be
readable, and it scrolls sideways rather than squeezing columns.
*/
/*
The fence info string: "```ts utils/date.ts" -> language + display label.

The web parses this with highlight.js, which knows aliases and can reject
nonsense (lib/markdown/code-block.ts). hljs is a web dependency and there is no
highlighting here yet (MH-319 item 1), so this keeps only the part that is
presentational: the first token is the language, anything after it is a
filename. A label is shown verbatim rather than validated — an unknown language
is a caption, not an error.
*/
export function parseFenceInfo(info: string): { lang: string; label: string } {
  const parts = info.trim().split(/\s+/).filter(Boolean);
  const lang = (parts[0] ?? "").toLowerCase();
  const named = parts.slice(1).join(" ");
  return { lang, label: named || lang || "" };
}

const TABLE_DELIMITER = /^\s*\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?\s*$/;

/** Split one row on unescaped pipes, dropping the optional leading/trailing pair. */
function tableCells(line: string): string[] {
  let body = line.trim();
  // The outer pipes are optional in GFM; strip them before splitting so
  // "| a | b |" and "a | b" produce the same two cells rather than two empties.
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  // Split on unescaped pipes only, then unescape — a cell may legitimately
  // contain "\|".
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const { lang, label } = parseFenceInfo(line.trim().slice(3));
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i += 1; }
      i += 1;
      blocks.push({ kind: "code", lines: codeLines, lang, label });
      continue;
    }
    // A table is header + delimiter, so it is checked before the paragraph
    // fallback and needs a lookahead at the NEXT line.
    if (line.includes("|") && i + 1 < lines.length && TABLE_DELIMITER.test(lines[i + 1])) {
      const header = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const cells = tableCells(lines[i]);
        // Pad or trim to the header width so the grid stays rectangular; a
        // ragged row is legal markdown and must not shift later columns.
        while (cells.length < header.length) cells.push("");
        rows.push(cells.slice(0, header.length));
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] }); i += 1; continue; }
    if (/^>\s?/.test(line)) { blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") }); i += 1; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) { blocks.push({ kind: "rule" }); i += 1; continue; }
    const ordered = line.match(/^\s*\d+\.\s+(.*)/);
    const unordered = line.match(/^\s*[-*]\s+(.*)/);
    if (ordered || unordered) {
      const isOrdered = !!ordered;
      const items: string[] = [(ordered || unordered)![1]];
      i += 1;
      while (i < lines.length) {
        const next = isOrdered ? lines[i].match(/^\s*\d+\.\s+(.*)/) : lines[i].match(/^\s*[-*]\s+(.*)/);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }
    if (line.trim() === "") { i += 1; continue; }
    blocks.push({ kind: "paragraph", text: line });
    i += 1;
  }
  return blocks;
}
