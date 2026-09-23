import type { AppearancePatch } from "@/components/notes/note-appearance-picker";

import type { Note } from "../../lib/api";
import type { TFn } from "../../lib/i18n";
import { SEP, type NativeMenuItem } from "../../lib/native-menu";
import { EXPORT_FORMATS, type ExportFormat } from "../editor/export";

/*
Every action a note has, in the order the mobile note sheet lists them
(mobile/src/features/notes/note-sheet.tsx) plus the desktop's own:

  open · open in new tab · open to the side · open in new window
  pin/unpin · archive/unarchive · icon & colour… · version history…
  copy markdown · export ▸ md/html/pdf/docx/png/txt
  delete…

ONE definition, shown as a NATIVE menu (lib/native-menu.ts) from a list row
(right-click), a tab, or the editor's "…" button — and mirrored by the app
menu bar's Note menu (commands note:*).
*/

export type NoteMenuAction =
  | { kind: "open" }
  | { kind: "open-new-tab" }
  | { kind: "open-side" }
  | { kind: "open-window" }
  | { kind: "pin" }
  | { kind: "archive" }
  | { kind: "appearance"; patch: AppearancePatch }
  | { kind: "appearance-picker" }
  | { kind: "versions" }
  | { kind: "copy" }
  | { kind: "export"; format: ExportFormat }
  | { kind: "delete" };

const FORMAT_LABELS: Record<ExportFormat, Parameters<TFn>[0]> = {
  md: "notes.x.fmt.md",
  html: "notes.x.fmt.html",
  pdf: "notes.x.fmt.pdf",
  docx: "notes.x.fmt.docx",
  png: "notes.x.fmt.png",
  txt: "notes.x.fmt.txt",
};

export function noteMenuItems(note: Note, t: TFn, { canWrite, showOpen = true, canOpenWindow = true }: {
  canWrite: boolean;
  /** The open actions make no sense for the note already in the editor. */
  showOpen?: boolean;
  canOpenWindow?: boolean;
}): NativeMenuItem[] {
  const items: NativeMenuItem[] = [];
  if (showOpen) {
    items.push(
      { id: "open", label: t("notes.x.open") },
      { id: "open-new-tab", label: t("ws.openNewTab") },
      { id: "open-side", label: t("ws.openToSide") },
    );
  }
  if (canOpenWindow) items.push({ id: "open-window", label: t("sb.openWindow"), accelerator: "Alt+CmdOrCtrl+O" });
  items.push(SEP);
  if (canWrite) {
    items.push(
      { id: "pin", label: note.pinned ? t("notes.x.unpin") : t("notes.x.pin") },
      { id: "archive", label: note.archived ? t("notes.x.unarchive") : t("notes.x.archive") },
      { id: "appearance-picker", label: `${t("notes.x.appearance")}…` },
    );
  }
  items.push({ id: "versions", label: `${t("notes.x.versions")}…` }, SEP, { id: "copy", label: t("notes.x.copy") });
  items.push({
    type: "submenu",
    label: t("notes.x.export"),
    submenu: EXPORT_FORMATS.map((f) => ({ id: `export:${f}`, label: t(FORMAT_LABELS[f]) })),
  });
  if (canWrite) items.push(SEP, { id: "delete", label: `${t("notes.x.delete")}…` });
  return items;
}

/** A chosen menu id back to the action it stands for. */
export function noteMenuAction(id: string): NoteMenuAction | null {
  if (id.startsWith("export:")) return { kind: "export", format: id.slice(7) as ExportFormat };
  switch (id) {
    case "open":
    case "open-new-tab":
    case "open-side":
    case "open-window":
    case "pin":
    case "archive":
    case "appearance-picker":
    case "versions":
    case "copy":
    case "delete":
      return { kind: id } as NoteMenuAction;
    default:
      return null;
  }
}
