import { Directory, File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { zekraApi, type Note } from "@/lib/api";
import { getReading } from "@/lib/reading-settings";

import { EXPORT_TYPES, exportFilename } from "./export-core";
import { exportHostToken, runEngineExport } from "./export-host";

/*
Note export on mobile (MH-368) — the web set (components/notes/note-export.tsx)
with the same generators:

  md    the body as authored
  txt   web markdownToTxt            } run in the hidden export page
  html  web noteToHtml, images inlined}  (<ExportHost/>, mounted at the root)
  docx  web markdownToDocx           }
  png   the note in the reading theme, html-to-image
  pdf   expo-print from the html export (web prints the same HTML server-side)

The file lands in the cache directory under the note's full title (sanitised,
export-core safeFilename) and the OS share sheet opens on it.

CONTRACT (used by the notes list): the two exports below keep this shape.
*/

export type ExportFormat = "md" | "html" | "pdf" | "docx" | "png" | "txt";

function exportsDir(): Directory {
  const dir = new Directory(Paths.cache, "exports");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function target(title: string, format: ExportFormat): File {
  const file = new File(exportsDir(), exportFilename(title, format));
  if (file.exists) file.delete();
  return file;
}

/** A list row may carry a note without its body; fetch it rather than export nothing. */
async function withBody(note: Note): Promise<string> {
  if (typeof note.body === "string") return note.body;
  const token = await exportHostToken();
  if (!token) throw new Error("not signed in");
  return (await zekraApi.note(token, note.id)).body ?? "";
}

export async function exportNote(note: Note, format: ExportFormat): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("sharing is not available on this device");
  const title = note.title?.trim() || "note";
  const markdown = await withBody(note);
  const themeId = getReading().theme;
  const info = EXPORT_TYPES[format];
  let file: File;

  switch (format) {
    case "md": {
      file = target(title, format);
      file.create();
      file.write(markdown);
      break;
    }
    case "pdf": {
      const { data } = await runEngineExport({ format: "html", markdown, title, themeId, dir: "auto" });
      const printed = await Print.printToFileAsync({ html: data });
      file = target(title, format);
      await new File(printed.uri).move(file);
      break;
    }
    default: {
      const { data, encoding } = await runEngineExport({ format, markdown, title, themeId, dir: "auto" });
      file = target(title, format);
      file.create();
      file.write(data, { encoding });
      break;
    }
  }

  await Sharing.shareAsync(file.uri, { mimeType: info.mime, UTI: info.uti, dialogTitle: title });
}
