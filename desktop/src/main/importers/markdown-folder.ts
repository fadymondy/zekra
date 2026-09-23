// Markdown folder importer (Obsidian vaults, Bear/Typora exports, any tree of
// notes). Ported from Mark It Down's "generic" importer, adapted to Zekra:
//   - .md / .markdown / .mdx, recursively; hidden dirs, .obsidian, .trash skipped
//   - YAML frontmatter -> title / tags / pinned / dates, then stripped
//   - title: frontmatter `title` > a leading `# H1` (removed from the body so it
//     is not shown twice) > the file name
//   - [[wiki links]] are KEPT: Zekra resolves them by note title natively
//   - local images (relative paths, Obsidian ![[embeds]]) become uploads
// A zip of such a folder works too (extracted by the caller).
"use strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { frontmatterTags, parseFrontmatter, type FrontmatterValue } from "../../shared/frontmatter";
import { rewriteLocalImages } from "./attachments";
import { walkFiles } from "./fs-util";
import type { Draft, Importer } from "./types";
import { IMAGE_MIME } from "./types";

const MD_EXTS = new Set([".md", ".markdown", ".mdx"]);
const IMAGE_EXTS = new Set(Object.keys(IMAGE_MIME).map((e) => `.${e}`));
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Pure: a markdown file's text -> title, tags, body (for tests). */
export function parseMarkdownNote(raw: string, fileName: string): Omit<Draft, "attachments"> {
  const fm = parseFrontmatter(raw.replace(/\r\n/g, "\n"));
  const data = fm.data;
  let body = fm.body;
  let title = str(data.title) || str(data.name);
  if (!title) {
    const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body);
    const firstContent = body.split("\n").find((l) => l.trim() !== "");
    if (h1 && firstContent !== undefined && firstContent.trim() === h1[0].trim()) {
      title = h1[1].trim();
      body = body.replace(h1[0], "").replace(/^\s*\n/, "");
    }
  }
  if (!title) title = fileName.replace(/\.(md|markdown|mdx)$/i, "");
  const tags = frontmatterTags(data);
  const pinned = data.pinned === true || data.pin === true;
  const archived = data.archived === true;
  const createdAt = isoDate(data.created ?? data.date ?? data.created_at ?? data.createdAt);
  const updatedAt = isoDate(data.updated ?? data.modified ?? data.updated_at ?? data.updatedAt);
  return { title, body: body.trim(), tags, pinned, archived, createdAt, updatedAt };
}

function str(v: FrontmatterValue | undefined): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function isoDate(v: FrontmatterValue | undefined): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export const importMarkdownFolder: Importer = async (root, ctx) => {
  const files = await walkFiles(root, MD_EXTS, ctx.signal);
  const images = await walkFiles(root, IMAGE_EXTS, ctx.signal);
  const byName = new Map<string, string>();
  for (const img of images) {
    const key = path.basename(img.abs).toLowerCase();
    if (!byName.has(key)) byName.set(key, img.abs);
  }

  const drafts: Draft[] = [];
  let done = 0;
  for (const f of files) {
    if (ctx.signal.aborted) break;
    ctx.progress(done++, files.length, f.rel);
    let raw: string;
    try {
      const st = await fs.stat(f.abs);
      if (st.size > MAX_FILE_BYTES) {
        ctx.warn(`${f.rel}: larger than 5 MB, skipped`);
        ctx.skip("too-large");
        continue;
      }
      raw = await fs.readFile(f.abs, "utf8");
    } catch (err) {
      ctx.warn(`${f.rel}: ${(err as Error).message}`);
      ctx.skip("unreadable");
      continue;
    }
    const note = parseMarkdownNote(raw, path.basename(f.abs));
    const attachments: Draft["attachments"] = [];
    const dir = path.dirname(f.abs);
    note.body = await rewriteLocalImages(
      note.body,
      (target) => {
        const abs = path.resolve(dir, target.split(/[?#]/)[0]);
        // Never read outside the folder the user picked.
        return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
      },
      attachments,
      byName,
    );
    if (!note.createdAt || !note.updatedAt) {
      try {
        const st = await fs.stat(f.abs);
        note.createdAt ??= st.birthtime.toISOString();
        note.updatedAt ??= st.mtime.toISOString();
      } catch {
        /* best effort */
      }
    }
    drafts.push({ ...note, attachments, origin: f.rel });
  }
  ctx.progress(files.length, files.length);
  return { drafts };
};
