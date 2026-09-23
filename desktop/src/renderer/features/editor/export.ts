import { Packer } from "docx";

import { EXPORT_TYPES, exportFilename, pngPixelRatio } from "@mobile/features/editor/export-core";
import { renderMarkdown } from "@/lib/markdown";
import { noteToHtml } from "@/lib/notes/export/html";
import { markdownToTxt } from "@/lib/notes/export/txt";
import { getSettings, readerStyle } from "@/lib/notes/note-settings";

import type { ExportFormat, SaveFileResult } from "../../../shared/ipc";
import { isApiImage, loadAuthedImage } from "../../lib/authed-image";
import { bridge } from "../../lib/bridge";

/*
Note export for the desktop — ONE entry point, `exportNote(note, format)`,
shared by the note context menu, the File ▸ Export menu commands and the
import/export feature.

Every format reuses the web's exporters (web/lib/notes/export/*) so a file
exported from the Mac is byte-for-byte what the console produces, with three
desktop substitutions:

  save   the native save dialog (window.zekra.saveFile), not an <a download>
  pdf    the main process prints the self-contained HTML export
         (window.zekra.printToPdf) instead of POSTing to the server — offline
         and identical to the HTML file
  images note images live behind the authed API (/api/notes/image/…), which a
         standalone file cannot reach; they are fetched through the proxy and
         inlined as data: URLs so HTML/PDF/PNG exports keep them
*/

export type { ExportFormat };

export const EXPORT_FORMATS: ExportFormat[] = ["md", "html", "pdf", "docx", "png", "txt"];

export type ExportableNote = { title: string; body?: string };

export type ExportOptions = {
  /** Reading theme id for html/pdf; defaults to the reading settings'. */
  theme?: string | null;
  dir?: "ltr" | "rtl" | "auto";
};

const FILTER_NAMES: Record<ExportFormat, string> = {
  md: "Markdown",
  html: "HTML",
  pdf: "PDF",
  docx: "Word",
  png: "PNG image",
  txt: "Plain text",
};

/**
 * The markdown a document export starts from: the note's title as an H1 over
 * its body — unless the body already opens with that heading.
 */
export function documentMarkdown(note: ExportableNote): string {
  const body = (note.body ?? "").trimEnd();
  const title = note.title.trim();
  if (!title) return body;
  const first = body.trimStart().split("\n", 1)[0] ?? "";
  if (/^#\s+/.test(first) && first.replace(/^#\s+/, "").trim() === title) return body;
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("could not read image"));
    r.readAsDataURL(blob);
  });
}

/** Replace every authed API image src in `html` with a data: URL. Images that
 *  cannot be fetched are left as they were (a broken image beats a failed export). */
export async function inlineApiImages(html: string): Promise<string> {
  const srcs = new Set<string>();
  html.replace(/<img\b[^>]*?\ssrc="([^"]+)"/gi, (m, src: string) => {
    const raw = src.replace(/&amp;/g, "&");
    if (isApiImage(raw)) srcs.add(src);
    return m;
  });
  if (!srcs.size) return html;
  const map = new Map<string, string>();
  await Promise.all(
    [...srcs].map(async (src) => {
      const blob = await loadAuthedImage(src.replace(/&amp;/g, "&"));
      if (blob) map.set(src, await blobToDataUrl(blob));
    }),
  );
  return html.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/gi, (m, a: string, src: string, b: string) =>
    map.has(src) ? `${a}${map.get(src)}${b}` : m,
  );
}

/*
The docx exporter (web/lib/notes/export/docx.ts) ends in Packer.toBuffer,
which needs Node's Buffer — absent in the sandboxed renderer. toArrayBuffer is
the same bytes; alias it once so the shared exporter runs unchanged.
*/
let docxPatched = false;
function patchDocx() {
  if (docxPatched) return;
  docxPatched = true;
  const P = Packer as unknown as { toBuffer: unknown; toArrayBuffer: (...a: unknown[]) => Promise<ArrayBuffer> };
  P.toBuffer = (...a: unknown[]) => P.toArrayBuffer(...a);
}

/* PNG: render the note offscreen with the reading pane's styles and capture it. */
const PNG_PROSE = [
  "space-y-3 text-sm leading-relaxed text-grid-fg bg-grid-bg p-8",
  "[&_a]:text-grid-action [&_a]:underline",
  "[&_h1]:text-xl [&_h1]:font-medium [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:border-b [&_h1]:border-line [&_h1]:pb-2",
  "[&_h2]:text-lg [&_h2]:font-medium [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-1.5",
  "[&_h3]:font-medium [&_h3]:mt-5",
  "[&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-3 [&_blockquote]:text-grid-muted",
  "[&_code]:bg-grid-soft [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_code]:rounded-sm",
  "[&_pre]:border [&_pre]:border-line [&_pre]:bg-grid-card [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:whitespace-pre-wrap",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5 [&_li]:ps-1",
  "[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_hr]:border-line",
  "[&_.zk-code-menu]:hidden [&_.zk-table-menu]:hidden",
].join(" ");

async function renderPng(markdown: string, dir: string): Promise<Uint8Array> {
  const { html } = renderMarkdown(markdown, { extractMermaid: false });
  const host = document.createElement("div");
  host.setAttribute("dir", dir);
  host.className = PNG_PROSE;
  Object.assign(host.style, readerStyle(getSettings()), {
    position: "fixed",
    insetInlineStart: "-10000px",
    top: "0",
    width: "820px",
    maxWidth: "820px",
  });
  host.innerHTML = await inlineApiImages(html);
  document.body.appendChild(host);
  try {
    // Wait for inlined images to decode, or the capture has holes.
    await Promise.all(
      Array.from(host.querySelectorAll("img")).map((img) => (img.complete ? null : img.decode().catch(() => null))),
    );
    const { toBlob } = await import("html-to-image");
    const ratio = pngPixelRatio(host.scrollWidth, host.scrollHeight, 2, 60_000_000);
    const opts = { pixelRatio: ratio, backgroundColor: getComputedStyle(host).backgroundColor };
    let blob: Blob | null = null;
    try {
      blob = await toBlob(host, opts);
    } catch {
      // Font embedding reads stylesheets from file://, which can fail; the
      // capture is still useful with system fonts.
      blob = await toBlob(host, { ...opts, skipFonts: true });
    }
    if (!blob) throw new Error("image export produced nothing");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    host.remove();
  }
}

/** The bytes (or text) of a note in `format`, without saving it. */
export async function renderNoteExport(
  note: ExportableNote,
  format: ExportFormat,
  opts: ExportOptions = {},
): Promise<{ text?: string; bytes?: Uint8Array }> {
  const markdown = documentMarkdown(note);
  const theme = opts.theme === undefined ? getSettings().theme : opts.theme;
  const dir = opts.dir ?? "auto";
  switch (format) {
    case "md":
      return { text: markdown + "\n" };
    case "txt":
      return { text: markdownToTxt(markdown) };
    case "html":
      return { text: await inlineApiImages(noteToHtml(markdown, { title: note.title || "note", theme, dir })) };
    case "pdf": {
      const html = await inlineApiImages(noteToHtml(markdown, { title: note.title || "note", theme, dir }));
      return { bytes: await bridge().printToPdf({ html, printBackground: true, pageSize: "A4" }) };
    }
    case "docx": {
      patchDocx();
      const { markdownToDocx } = await import("@/lib/notes/export/docx");
      const buf = (await markdownToDocx(markdown)) as unknown as ArrayBuffer | Uint8Array;
      return { bytes: buf instanceof Uint8Array ? buf : new Uint8Array(buf) };
    }
    case "png":
      return { bytes: await renderPng(markdown, dir) };
  }
}

/**
 * Export a note through the native save dialog. Resolves with the dialog's
 * result (`canceled: true` when the user backed out); throws on a real failure.
 */
export async function exportNote(
  note: ExportableNote,
  format: ExportFormat,
  opts: ExportOptions = {},
): Promise<SaveFileResult> {
  const out = await renderNoteExport(note, format, opts);
  return bridge().saveFile({
    suggestedName: exportFilename(note.title, format),
    filters: [{ name: FILTER_NAMES[format], extensions: [EXPORT_TYPES[format].ext] }],
    ...(out.text !== undefined ? { text: out.text } : { bytes: out.bytes }),
  });
}
