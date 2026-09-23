import { useCallback, useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { ApiError, type Brain, type Note, type NotePatch } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useCommands } from "../../shell/commands";
import { toast } from "../../shell/toast";
import { AppearancePicker } from "../editor/appearance-picker";
import { exportNote } from "../editor/export";
import type { NoteMenuAction } from "./note-menu";
import { notesApi } from "./notes-api";
import { noteMarkdown } from "./notes-model";
import { VersionHistoryDialog } from "./version-history-dialog";

/*
Runs a NoteMenuAction — the same outcomes and messages as mobile's
use-note-actions.ts:

  pin / appearance   apply at once (trivially reversible)
  archive / delete   confirm first
  versions           the history dialog
  copy               markdown to the clipboard
  export             exportNote() through the native save dialog

Writes use the freshest copy the workspace knows (`latest`), because the list
row's copy can be a version behind the open editor; a 409 re-reads the note
and retries once for the metadata-only changes (pin/archive/appearance), which
cannot clobber anyone's text.
*/


export function useNoteActions({ token, brain, latest, onChanged, onRemoved, onOpen, onRename }: {
  token: string;
  brain: Brain;
  /** The freshest known copy of a note (editor/cache), or the note itself. */
  latest: (note: Note) => Note;
  onChanged: (note: Note) => void;
  onRemoved: (note: Note) => void;
  onOpen: (note: Note, how: "open" | "open-new-tab" | "open-side") => void;
  /** Rename: open the note and select its title (default: the focused editor). */
  onRename?: (note: Note) => void;
}): { run: (note: Note, action: NoteMenuAction) => void; dialogs: ReactNode } {
  const { t, dir } = useI18n();
  const commands = useCommands();
  const [history, setHistory] = useState<Note | null>(null);
  const [styling, setStyling] = useState<Note | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) toast.error(t("notes.x.conflict"));
      else if (e instanceof ApiError && e.status === 0) toast.error(t("notes.x.offline"));
      else toast.error(t("notes.x.failed"));
    },
    [t],
  );

  const patchNote = useCallback(
    async (note: Note, patch: NotePatch): Promise<Note> => {
      try {
        return await notesApi.update(token, latest(note), patch);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        const fresh = await notesApi.get(token, note.id);
        return notesApi.update(token, fresh, patch);
      }
    },
    [token, latest],
  );

  const run = useCallback(
    (note: Note, action: NoteMenuAction) => {
      switch (action.kind) {
        case "open":
        case "open-new-tab":
        case "open-side":
          onOpen(note, action.kind);
          return;
        case "rename":
          if (onRename) onRename(note);
          else commands.run("note:rename");
          return;
        case "view-source":
          // The focused editor owns it (the "…" that asked is in that pane).
          commands.run("note:view-source");
          return;
        case "pin":
          void patchNote(note, { pinned: !latest(note).pinned })
            .then((saved) => {
              onChanged(saved);
              toast.success(saved.pinned ? t("notes.x.pinned") : t("notes.x.unpinned"));
            })
            .catch(fail);
          return;
        case "appearance":
          void patchNote(note, action.patch).then(onChanged).catch(fail);
          return;
        case "archive":
        case "delete":
          void confirmThen(note, action.kind);
          return;
        case "open-window":
          void bridge().openNoteWindow?.({ namespace: note.namespace || brain.namespace, id: note.id, title: note.title });
          return;
        case "appearance-picker":
          setStyling(latest(note));
          return;
        case "versions":
          setHistory(latest(note));
          return;
        case "copy":
          void bridge()
            .writeClipboardText(noteMarkdown(latest(note)))
            .then(() => toast.success(t("notes.x.copied")))
            .catch(fail);
          return;
        case "export": {
          const n = latest(note);
          const id = toast.loading(t("editor.exporting", { format: action.format.toUpperCase() }));
          void exportNote({ title: n.title, body: n.body }, action.format, { dir })
            .then((res) => {
              toast.dismiss(id);
              if (!res.canceled) toast.success(t("ws.exported", { name: (res.path ?? "").split(/[\\/]/).pop() || action.format }));
            })
            .catch((e: unknown) => {
              toast.dismiss(id);
              toast.error(t("notes.x.exportFailed", { reason: e instanceof Error ? e.message : String(e) }));
            });
          return;
        }
      }
    },
    [onOpen, onRename, commands, patchNote, latest, onChanged, fail, t, dir, brain.namespace],
  );

  // Archive / delete: the OS's own confirmation (sheet-attached on macOS).
  async function confirmThen(note: Note, action: "archive" | "delete") {
    const archived = latest(note).archived;
    const del = action === "delete";
    const { response } = await bridge().confirm({
      type: del ? "warning" : "question",
      message: del ? t("notes.x.deleteTitle") : archived ? t("notes.x.unarchiveTitle") : t("notes.x.archiveTitle"),
      detail: del ? t("notes.x.deleteBody") : archived ? t("notes.x.unarchiveBody") : t("notes.x.archiveBody"),
      buttons: [del ? t("notes.x.delete") : archived ? t("notes.x.unarchive") : t("notes.x.archive"), t("action.cancel")],
      defaultId: del ? 1 : 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    try {
      if (del) {
        await notesApi.remove(token, latest(note));
        onRemoved(note);
        toast.success(t("notes.x.deleted"));
      } else {
        const saved = await patchNote(note, { archived: !latest(note).archived });
        onChanged(saved);
        toast.success(saved.archived ? t("notes.x.archived") : t("notes.x.unarchived"));
      }
    } catch (e) {
      fail(e);
    }
  }

  const dialogs = (
    <>
      <Dialog open={!!styling} onOpenChange={(o) => !o && setStyling(null)}>
        <DialogContent className="w-auto max-w-[360px] p-4">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-semibold">{t("sheet.appearance")}</DialogTitle>
            <DialogDescription className="sr-only">{styling?.title}</DialogDescription>
          </DialogHeader>
          {styling ? (
            <AppearancePicker
              icon={styling.icon}
              color={styling.color}
              category={styling.category}
              onChange={(patch) => {
                const target = styling;
                setStyling((s) => (s ? { ...s, ...patch } : s));
                void patchNote(target, patch).then(onChanged).catch(fail);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <VersionHistoryDialog
        note={history}
        token={token}
        canWrite={brain.canWrite}
        onOpenChange={(o) => {
          if (!o) setHistory(null);
        }}
        onRestored={onChanged}
      />
    </>
  );

  return { run, dialogs };
}
