import type { ComponentType, ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileDown,
  FileImage,
  FileText,
  FileType,
  Hash,
  History,
  Palette,
  Pin,
  PinOff,
  SquarePlus,
  Trash2,
} from "lucide-react";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { NoteAppearancePicker, type AppearancePatch } from "@/components/notes/note-appearance-picker";

import type { Note } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import { EXPORT_FORMATS, type ExportFormat } from "../editor/export";

/*
Every action a note has, in the order the mobile note sheet lists them
(mobile/src/features/notes/note-sheet.tsx) plus the desktop's tab actions:

  open · open in new tab · open to the side
  pin/unpin · archive/unarchive · icon & colour · version history
  copy markdown · export ▸ md/html/pdf/docx/png/txt
  delete

Rendered as a right-click menu (sidebar rows, tabs) or a "…" dropdown (the
editor header) from ONE definition, so the two cannot drift.
*/

export type NoteMenuAction =
  | { kind: "open" }
  | { kind: "open-new-tab" }
  | { kind: "open-side" }
  | { kind: "pin" }
  | { kind: "archive" }
  | { kind: "appearance"; patch: AppearancePatch }
  | { kind: "versions" }
  | { kind: "copy" }
  | { kind: "export"; format: ExportFormat }
  | { kind: "delete" };

const FORMAT_ICONS: Record<ExportFormat, ComponentType<{ className?: string }>> = {
  md: Hash,
  html: FileCode,
  pdf: FileDown,
  docx: FileType,
  png: FileImage,
  txt: FileText,
};

const FORMAT_LABELS: Record<ExportFormat, TKey> = {
  md: "notes.x.fmt.md",
  html: "notes.x.fmt.html",
  pdf: "notes.x.fmt.pdf",
  docx: "notes.x.fmt.docx",
  png: "notes.x.fmt.png",
  txt: "notes.x.fmt.txt",
};

type Kit = {
  Item: ComponentType<{ onClick?: () => void; variant?: "default" | "destructive"; children?: ReactNode; disabled?: boolean }>;
  Separator: ComponentType;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ children?: ReactNode }>;
  SubContent: ComponentType<{ children?: ReactNode; className?: string }>;
};

const CONTEXT: Kit = {
  Item: ContextMenuItem as Kit["Item"],
  Separator: ContextMenuSeparator as Kit["Separator"],
  Sub: ContextMenuSub as Kit["Sub"],
  SubTrigger: ContextMenuSubTrigger as Kit["SubTrigger"],
  SubContent: ContextMenuSubContent as Kit["SubContent"],
};

const DROPDOWN: Kit = {
  Item: DropdownMenuItem as Kit["Item"],
  Separator: DropdownMenuSeparator as Kit["Separator"],
  Sub: DropdownMenuSub as Kit["Sub"],
  SubTrigger: DropdownMenuSubTrigger as Kit["SubTrigger"],
  SubContent: DropdownMenuSubContent as Kit["SubContent"],
};

export function NoteMenuItems({ note, kind, canWrite, onAction, showOpen = true }: {
  note: Note;
  kind: "context" | "dropdown";
  canWrite: boolean;
  onAction: (a: NoteMenuAction) => void;
  /** The open actions make no sense for the note already in the editor. */
  showOpen?: boolean;
}) {
  const { t } = useI18n();
  const K = kind === "context" ? CONTEXT : DROPDOWN;

  return (
    <>
      {showOpen ? (
        <>
          <K.Item onClick={() => onAction({ kind: "open" })}>
            <ExternalLink />
            {t("notes.x.open")}
          </K.Item>
          <K.Item onClick={() => onAction({ kind: "open-new-tab" })}>
            <SquarePlus />
            {t("ws.openNewTab")}
          </K.Item>
          <K.Item onClick={() => onAction({ kind: "open-side" })}>
            <Columns2 />
            {t("ws.openToSide")}
          </K.Item>
          <K.Separator />
        </>
      ) : null}

      {canWrite ? (
        <>
          <K.Item onClick={() => onAction({ kind: "pin" })}>
            {note.pinned ? <PinOff /> : <Pin />}
            {note.pinned ? t("notes.x.unpin") : t("notes.x.pin")}
          </K.Item>
          <K.Item onClick={() => onAction({ kind: "archive" })}>
            {note.archived ? <ArchiveRestore /> : <Archive />}
            {note.archived ? t("notes.x.unarchive") : t("notes.x.archive")}
          </K.Item>
          <K.Sub>
            <K.SubTrigger>
              <Palette />
              {t("notes.x.appearance")}
            </K.SubTrigger>
            <K.SubContent>
              <NoteAppearancePicker
                icon={note.icon}
                color={note.color}
                category={note.category}
                onChange={(patch) => onAction({ kind: "appearance", patch })}
              />
            </K.SubContent>
          </K.Sub>
        </>
      ) : null}
      <K.Item onClick={() => onAction({ kind: "versions" })}>
        <History />
        {t("notes.x.versions")}
      </K.Item>

      <K.Separator />
      <K.Item onClick={() => onAction({ kind: "copy" })}>
        <Copy />
        {t("notes.x.copy")}
      </K.Item>
      <K.Sub>
        <K.SubTrigger>
          <Download />
          {t("notes.x.export")}
        </K.SubTrigger>
        <K.SubContent className="min-w-44">
          {EXPORT_FORMATS.map((f) => {
            const Icon = FORMAT_ICONS[f];
            return (
              <K.Item key={f} onClick={() => onAction({ kind: "export", format: f })}>
                <Icon />
                {t(FORMAT_LABELS[f])}
              </K.Item>
            );
          })}
        </K.SubContent>
      </K.Sub>

      {canWrite ? (
        <>
          <K.Separator />
          <K.Item variant="destructive" onClick={() => onAction({ kind: "delete" })}>
            <Trash2 />
            {t("notes.x.delete")}
          </K.Item>
        </>
      ) : null}
    </>
  );
}
