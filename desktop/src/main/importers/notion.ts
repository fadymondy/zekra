// Notion importer: "Export -> Markdown & CSV" (the .zip, nested part zips, or
// the extracted folder). Ported from Mark It Down's notion importer
// (normalize.ts + db.ts), adapted to Zekra:
//   - the 32-hex id suffix is stripped from every name
//   - links between exported pages become [[Page Title|label]] wiki links,
//     which Zekra resolves by note title (MID rewrote them to .md paths)
//   - <aside> callouts -> blockquotes; toggle headings -> <details>
//   - images in a page's asset folder become uploads
//   - each database CSV becomes an index note: a GFM table whose first column
//     links to the row pages
//   - the page's leading "# Title" is dropped (Zekra shows the title itself)
"use strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { rewriteLocalImages } from "./attachments";
import { toPosix, walkFiles } from "./fs-util";
import type { Draft, Importer } from "./types";

/* ---------------------------------------------------------- pure parts */

/** "Page Title 0123…cdef.md" -> { name: "Page Title.md", hash }. */
export function stripNotionHash(segment: string): { name: string; hash?: string } {
  const dot = segment.lastIndexOf(".");
  const hasExt = dot > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(segment.slice(dot));
  const stem = hasExt ? segment.slice(0, dot) : segment;
  const ext = hasExt ? segment.slice(dot) : "";
  const m = /^(.*?)\s+([0-9a-f]{32})(_all)?$/i.exec(stem);
  if (!m) return { name: segment };
  return { name: (m[1] + (m[3] ?? "") + ext).trim(), hash: m[2].toLowerCase() };
}

export function stripNotionHashFromPath(p: string): string {
  return p
    .split("/")
    .map((s) => stripNotionHash(s).name)
    .join("/");
}

/** Toggle headings (`## ▸ Title` + indented body) -> <details>. */
export function collapseToggles(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^(#{1,6})\s+[▾▸▼►]\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) {
      out.push(lines[i++]);
      continue;
    }
    const children: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() === "") i++;
    while (i < lines.length) {
      const c = lines[i];
      if (c.trim() === "") {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && /^( {4}|\t)/.test(lines[j])) {
          children.push("");
          i = j;
          continue;
        }
        break;
      }
      if (!/^( {4}|\t)/.test(c)) break;
      children.push(c.replace(/^( {4}|\t)/, ""));
      i++;
    }
    out.push("<details>", `<summary>${m[2].trim()}</summary>`, "", ...children, "", "</details>");
  }
  return out.join("\n");
}

/** Resolve `rel` against the POSIX dir `from`. */
export function joinPosix(from: string, rel: string): string {
  if (rel.startsWith("/")) return rel.replace(/^\/+/, "");
  const parts = from.split("/").filter((p) => p && p !== ".");
  for (const p of rel.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Notion markdown -> Zekra markdown (everything but images, which need the
 * filesystem). `pageTitles` maps a hash-stripped, lower-cased export path to
 * the imported note title; `sourceDir` is the page's POSIX dir in the export.
 */
export function normaliseNotionMarkdown(body: string, sourceDir: string, pageTitles: Map<string, string>): string {
  let out = body.replace(/\r\n/g, "\n");
  out = out.replace(/<aside>([\s\S]*?)<\/aside>/g, (_m, inner: string) =>
    String(inner)
      .trim()
      .split("\n")
      .map((l) => `> ${l}`.trimEnd())
      .join("\n"),
  );
  out = collapseToggles(out);
  // Page links (not images): [label](Other%20Page%20<hash>.md) -> [[Title|label]]
  out = out.replace(/(^|[^!])\[([^\]\n]*)\]\(([^)\n]+)\)/g, (match, lead: string, label: string, target: string) => {
    const t = target.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#")) return match;
    const decoded = safeDecode(t.split("#")[0]);
    if (!/\.(md|markdown)$/i.test(decoded)) {
      // A link to a sub-folder or a CSV database: strip the hashes at least.
      return `${lead}[${label}](${encodeURI(stripNotionHashFromPath(joinPosix(sourceDir, decoded)))})`;
    }
    const key = stripNotionHashFromPath(joinPosix(sourceDir, decoded)).toLowerCase();
    const title = pageTitles.get(key) ?? stripNotionHash(decoded.split("/").pop() ?? decoded).name.replace(/\.(md|markdown)$/i, "");
    const text = label.trim();
    return `${lead}[[${title}${text && text !== title ? `|${text}` : ""}]]`;
  });
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** RFC 4180 CSV: quotes, "" escapes, embedded newlines, CRLF, BOM. */
export function parseCsv(input: string): CsvTable | null {
  const src = (input ?? "").replace(/^﻿/, "");
  if (!src.trim()) return null;
  const records: string[][] = [[]];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      records[records.length - 1].push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      records[records.length - 1].push(cur);
      cur = "";
      records.push([]);
    } else cur += c;
  }
  records[records.length - 1].push(cur);
  while (records.length && records[records.length - 1].length === 1 && records[records.length - 1][0] === "") records.pop();
  if (!records.length) return null;
  const [headers, ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows };
}

const cell = (v: string) => (v ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

/** A database as a GFM table; first-column titles that match a row page link to it. */
export function databaseIndexMarkdown(table: CsvTable, rowTitles: Set<string>): string {
  const headers = table.headers.length ? table.headers : ["Name"];
  const width = headers.length;
  const lines = [`| ${headers.map(cell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of table.rows) {
    const cells = [...r, ...Array(Math.max(0, width - r.length)).fill("")].slice(0, width);
    const first = cell(cells[0]);
    cells[0] = first && rowTitles.has(first.toLowerCase()) ? `[[${first}]]` : first;
    lines.push(`| ${[cells[0], ...cells.slice(1).map(cell)].join(" | ")} |`);
  }
  return [`_Database imported from Notion — ${table.rows.length} row${table.rows.length === 1 ? "" : "s"}._`, "", ...lines].join("\n");
}

/* ------------------------------------------------------------ importer */

export const importNotion: Importer = async (root, ctx) => {
  const pages = await walkFiles(root, new Set([".md", ".markdown"]), ctx.signal);
  const csvs = await walkFiles(root, new Set([".csv"]), ctx.signal);
  if (!pages.length && !csvs.length) {
    throw Object.assign(new Error("No Notion export found (expected .md pages and .csv databases)."), { code: "not-found" });
  }

  // Titles first, so links between pages resolve to the imported titles.
  const titleOf = new Map<string, string>(); // clean rel (lower) -> title
  const used = new Map<string, number>();
  const pageInfo = pages.map((p) => {
    const clean = stripNotionHashFromPath(p.rel);
    const base = clean.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
    const n = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), n);
    const title = n === 1 ? base : `${base} (${n})`;
    titleOf.set(clean.toLowerCase(), title);
    return { ...p, clean, title, hash: stripNotionHash(p.rel.split("/").pop()!).hash };
  });

  const drafts: Draft[] = [];
  const total = pages.length + csvs.length;
  let done = 0;
  for (const p of pageInfo) {
    if (ctx.signal.aborted) break;
    ctx.progress(done++, total, p.clean);
    let raw: string;
    try {
      raw = await fs.readFile(p.abs, "utf8");
    } catch (err) {
      ctx.warn(`${p.clean}: ${(err as Error).message}`);
      ctx.skip("unreadable");
      continue;
    }
    const sourceDir = toPosix(path.dirname(p.rel)) === "." ? "" : toPosix(path.dirname(p.rel));
    let body = normaliseNotionMarkdown(raw, sourceDir, titleOf);
    // Drop the leading "# Title" Notion writes into every page.
    const firstLine = body.split("\n", 1)[0] ?? "";
    if (/^#\s+/.test(firstLine)) body = body.slice(firstLine.length).replace(/^\s*\n/, "");
    const attachments: Draft["attachments"] = [];
    const dir = path.dirname(p.abs);
    const rootAbs = path.resolve(root) + path.sep;
    body = await rewriteLocalImages(
      body,
      (target) => {
        const abs = path.resolve(dir, safeDecode(target.split(/[?#]/)[0]));
        return abs.startsWith(rootAbs) ? abs : null;
      },
      attachments,
    );
    let createdAt: string | undefined;
    let updatedAt: string | undefined;
    try {
      const st = await fs.stat(p.abs);
      createdAt = st.birthtime.toISOString();
      updatedAt = st.mtime.toISOString();
    } catch {
      /* best effort */
    }
    drafts.push({ title: p.title, body: body.trim(), tags: [], attachments, createdAt, updatedAt, origin: p.clean });
  }

  // Databases. Newer exports write both "<db>.csv" and "<db>_all.csv"; the
  // _all one has every row, so it wins.
  const byDb = new Map<string, (typeof csvs)[number]>();
  for (const c of csvs) {
    const clean = stripNotionHashFromPath(c.rel).replace(/(_all)?\.csv$/i, "");
    const prev = byDb.get(clean);
    if (!prev || /_all\.csv$/i.test(c.rel)) byDb.set(clean, c);
  }
  for (const [clean, c] of byDb) {
    if (ctx.signal.aborted) break;
    ctx.progress(done++, total, clean);
    let table: CsvTable | null = null;
    try {
      table = parseCsv(await fs.readFile(c.abs, "utf8"));
    } catch {
      table = null;
    }
    if (!table) {
      ctx.skip("empty");
      continue;
    }
    const prefix = clean.toLowerCase() + "/";
    const rowTitles = new Set<string>();
    for (const p of pageInfo) if (p.clean.toLowerCase().startsWith(prefix)) rowTitles.add(p.title.toLowerCase());
    let title = clean.split("/").pop() || "Database";
    if (used.has(title.toLowerCase())) title = `${title} (database)`;
    drafts.push({ title, body: databaseIndexMarkdown(table, rowTitles), tags: ["notion-database"], attachments: [], origin: stripNotionHashFromPath(c.rel) });
  }
  ctx.progress(total, total);
  return { drafts };
};
