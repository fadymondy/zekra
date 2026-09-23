import { memo, type MouseEvent, type ReactNode } from "react";
import { Archive, LoaderCircle, Pin, TriangleAlert } from "lucide-react";

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { noteIcon } from "@/lib/notes/note-icon";
import { cn } from "@/lib/utils";

import { ago, snippet } from "../features/notes/notes-model";
import type { Note } from "../lib/api";
import { useI18n } from "../lib/i18n";

/*
A note in the workspace sidebar (MH-450), the mobile row in desktop form:
the note's icon in its colour (category-derived or its MH-308 override), the
title (pinned mark), two lines of body, and a meta line — age, tags,
archived / indexing state.

  click           open (replaces the preview tab)
  ⌘-click, middle open in a new tab
  ⌥-click         open to the side (split)
  right-click     every note action (features/notes/note-menu.tsx)
  drag            onto a tab strip to open it in that group

The mime type carries enough to open the tab without a lookup.
*/

export const NOTE_DRAG_MIME = "application/x-zekra-note";

export type OpenHow = "open" | "open-new-tab" | "open-side";

export const NoteRow = memo(function NoteRow({ note, selected, open, menu, onOpen }: {
  note: Note;
  /** The note shown in the focused editor. */
  selected: boolean;
  /** Open in some tab. */
  open: boolean;
  /** Context-menu content (NoteMenuItems). */
  menu: ReactNode;
  onOpen: (how: OpenHow) => void;
}) {
  const { t, locale } = useI18n();
  const { Icon, color } = noteIcon({ category: note.category, icon: note.icon, color: note.color });
  const text = snippet(note.body, 160);
  const age = ago(note.updatedAt);
  const when =
    age.unit === "now"
      ? t("notes.x.now")
      : age.unit === "m"
        ? t("notes.x.minutes", { n: age.n })
        : age.unit === "h"
          ? t("notes.x.hours", { n: age.n })
          : age.unit === "d"
            ? t("notes.x.days", { n: age.n })
            : new Date(note.updatedAt).toLocaleDateString(locale === "ar" ? "ar" : "en", { month: "short", day: "numeric", year: "numeric" });

  function click(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) onOpen("open-new-tab");
    else if (e.altKey) onOpen("open-side");
    else onOpen("open");
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            data-note-row={note.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copyMove";
              e.dataTransfer.setData(
                NOTE_DRAG_MIME,
                JSON.stringify({ id: note.id, title: note.title, category: note.category, icon: note.icon, color: note.color }),
              );
              e.dataTransfer.setData("text/plain", note.title);
            }}
            onClick={click}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onOpen("open-new-tab");
              }
            }}
            className={cn(
              "group relative flex w-full min-w-0 items-start gap-2.5 border-b border-line px-3 py-2.5 text-start transition-colors outline-none",
              "focus-visible:bg-grid-soft",
              selected ? "bg-grid-soft" : "hover:bg-grid-soft/60",
            )}
          />
        }
      >
        {/* Selection rule on the start edge, gold like the house selection. */}
        {selected ? <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-grid-gold" /> : null}
        <Icon className="mt-0.5 size-4 shrink-0" style={{ color }} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn("min-w-0 flex-1 truncate text-[13.5px] text-grid-fg", open ? "font-semibold" : "font-medium")}
              style={{ unicodeBidi: "plaintext" }}
            >
              {note.title || t("notes.x.untitled")}
            </span>
            {note.pinned ? <Pin aria-label={t("notes.x.pinnedLabel")} className="size-3 shrink-0 text-grid-gold" /> : null}
          </span>
          {text ? (
            <span dir="auto" className="mt-0.5 line-clamp-2 text-xs leading-[1.45] text-grid-muted">
              {text}
            </span>
          ) : null}
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-grid-muted">
            <span className="shrink-0 tabular-nums">{when}</span>
            {note.archived ? (
              <span className="flex shrink-0 items-center gap-0.5">
                · <Archive className="size-3" /> {t("notes.x.archivedLabel")}
              </span>
            ) : null}
            {note.indexError ? (
              <span className="flex shrink-0 items-center gap-0.5 text-grid-danger" title={note.indexError}>
                · <TriangleAlert className="size-3" />
              </span>
            ) : !note.indexed ? (
              <span className="flex shrink-0 items-center gap-0.5" title={t("notes.x.indexing")}>
                · <LoaderCircle className="size-3 animate-spin" />
              </span>
            ) : null}
            {note.tags.length ? (
              <span className="min-w-0 truncate">
                ·{" "}
                {note.tags.slice(0, 3).map((tag) => (
                  <bdi key={tag} className="me-1">
                    #{tag}
                  </bdi>
                ))}
              </span>
            ) : null}
          </span>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">{menu}</ContextMenuContent>
    </ContextMenu>
  );
});
