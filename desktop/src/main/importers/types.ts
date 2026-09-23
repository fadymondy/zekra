// Internal importer contract (main process only). The renderer sees the
// serialisable shapes in src/shared/ipc.ts (ImportDraft, ImportScanResult …);
// this adds what only main needs: where attachment bytes live on disk.
//
// Ported from Mark It Down (apps/electron/importers/types.ts). MID wrote notes
// into a workspace folder; Zekra creates them through the API, so an importer
// here only PARSES — it yields drafts, and the renderer uploads them.
"use strict";

import type { ImportSource } from "../../shared/ipc";

export interface DraftAttachment {
  /** Placeholder id used in the body as `zekra-attachment:<ref>`. */
  ref: string;
  name: string;
  mime: string;
  /** Bytes on disk (Keep / Notion) … */
  path?: string;
  /** … or inline (Apple Notes data: images). */
  base64?: string;
}

export interface Draft {
  title: string;
  /** Markdown, no frontmatter. Attachment refs appear as zekra-attachment:<ref>. */
  body: string;
  tags: string[];
  pinned?: boolean;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  attachments: DraftAttachment[];
  /** Where it came from (relative path, folder), for the failure report. */
  origin?: string;
}

export interface ScanContext {
  /** Set when the user cancels; importers check it between files. */
  signal: AbortSignal;
  progress: (done: number, total: number | undefined, message?: string) => void;
  warn: (message: string) => void;
  /** Count a note that will not be imported, by reason (locked, trashed …). */
  skip: (reason: string) => void;
}

export interface ScanOutput {
  drafts: Draft[];
}

export type Importer = (input: string, ctx: ScanContext) => Promise<ScanOutput>;

export const ATTACHMENT_SCHEME = "zekra-attachment:";

/** Images the notes API accepts on /api/notes/image. */
export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function mimeForName(name: string): string | undefined {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_MIME[ext];
}

export type { ImportSource };
