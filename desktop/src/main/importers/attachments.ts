// Local images referenced from imported markdown (markdown folders, Notion
// pages): `![alt](rel/path.png)` and Obsidian `![[image.png]]`. Each image
// that exists on disk, is an image type the notes API accepts, and is under
// the size cap becomes a DraftAttachment; its reference in the body is
// rewritten to `zekra-attachment:<ref>`, which the renderer swaps for the
// uploaded URL. Everything else is left as written.
"use strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ATTACHMENT_SCHEME, MAX_ATTACHMENT_BYTES, mimeForName, type DraftAttachment } from "./types";

let counter = 0;
export function nextRef(): string {
  counter += 1;
  return `a${Date.now().toString(36)}${counter.toString(36)}`;
}

export async function attachmentFromPath(abs: string, name = path.basename(abs)): Promise<DraftAttachment | null> {
  const mime = mimeForName(name);
  if (!mime) return null;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile() || st.size === 0 || st.size > MAX_ATTACHMENT_BYTES) return null;
  } catch {
    return null;
  }
  return { ref: nextRef(), name, mime, path: abs };
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/**
 * Rewrite local image references in `body`.
 *  - `resolve(target)` maps a link target to an absolute path (or null).
 *  - `byName` resolves Obsidian embeds by file name.
 */
export async function rewriteLocalImages(
  body: string,
  resolve: (target: string) => string | null,
  out: DraftAttachment[],
  byName?: Map<string, string>,
): Promise<string> {
  const jobs: { match: string; replacement: Promise<string> }[] = [];
  // Promises, not refs: both syntaxes may name the same file, and the lookups
  // run concurrently — one attachment per file either way.
  const seen = new Map<string, Promise<string | null>>();

  const refFor = (abs: string): Promise<string | null> => {
    let p = seen.get(abs);
    if (!p) {
      p = attachmentFromPath(abs).then((att) => {
        if (!att) return null;
        out.push(att);
        return att.ref;
      });
      seen.set(abs, p);
    }
    return p;
  };

  // ![alt](target "title")
  body.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (match, alt: string, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return match;
    const abs = resolve(safeDecode(target));
    if (!abs) return match;
    jobs.push({
      match,
      replacement: refFor(abs).then((ref) => (ref ? `![${alt}](${ATTACHMENT_SCHEME}${ref})` : match)),
    });
    return match;
  });

  // ![[image.png]] / ![[image.png|300]]
  if (byName) {
    body.replace(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g, (match, name: string) => {
      const abs = byName.get(path.basename(name.trim()).toLowerCase());
      if (!abs) return match;
      jobs.push({
        match,
        replacement: refFor(abs).then((ref) => (ref ? `![${path.basename(abs)}](${ATTACHMENT_SCHEME}${ref})` : match)),
      });
      return match;
    });
  }

  if (!jobs.length) return body;
  let result = body;
  for (const j of jobs) {
    const rep = await j.replacement;
    if (rep !== j.match) result = result.split(j.match).join(rep);
  }
  return result;
}
