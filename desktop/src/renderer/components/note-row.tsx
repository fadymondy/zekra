import { memo, type MouseEvent } from "react";
import { Archive, LoaderCircle, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import { ago, snippet } from "../features/notes/notes-model";
import type { Note } from "../lib/api";
import { useI18n } from "../lib/i18n";

/*
A note in the workspace's list column (MH-450) — a dense source-list row in
the shape of Notes / Linear:

  ● Title (13px semibold)                      2h
    one line of the body, muted

The dot appears only when the note has its own colour (MH-308 override);
archived / indexing / index-error show as tiny glyphs by the time.

  click           open (replaces the preview tab)
  ⌘-click, middle open in a new tab
  ⌥-click         open to the side (split)
  double-click    open in its own window
  right-click     every note action, as a native menu (features/notes/note-menu.tsx)
  drag            onto a tab strip to open it in that group

The mime type carries enough to open the tab without a lookup.
*/

export const NOTE_DRAG_MIME = "application/x-zekra-note";

export type OpenHow = "open" | "open-new-tab" | "open-side";

/** The trailing date, the way Notes and Mail write it: the time today,
 *  "Yesterday", the weekday this week, else the date. */
export function useListDate() {
  const { t, locale } = useI18n();
  const loc = locale === "ar" ? "ar" : "en";
  return (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86_400_000);
    if (diff <= 0) return d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" });
    if (diff === 1) return t("grp.yesterday");
    if (diff < 7) return d.toLocaleDateString(loc, { weekday: "long" });
    return d.toLocaleDateString(loc, { day: "numeric", month: "numeric", year: "2-digit" });
  };
}

/** Kept for callers that want the compact relative age ("5m", "2d"). */
export function useAgo() {
  const { t, locale } = useI18n();
  return (iso: string) => {
    const age = ago(iso);
    return age.unit === "now"
      ? t("notes.x.now")
      : age.unit === "m"
        ? t("notes.x.minutes", { n: age.n })
        : age.unit === "h"
          ? t("notes.x.hours", { n: age.n })
          : age.unit === "d"
            ? t("notes.x.days", { n: age.n })
            : new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : "en", { month: "short", day: "numeric" });
  };
}

export const NoteRow = memo(function NoteRow({ note, selected, open, onMenu, onOpen }: {
  note: Note;
  /** The note shown in the focused editor. */
  selected: boolean;
  /** Open in some tab. */
  open: boolean;
  /** Right-click: pop the note's native menu. */
  onMenu: (e: MouseEvent) => void;
  onOpen: (how: OpenHow | "open-window") => void;
}) {
  const { t } = useI18n();
  const when = useListDate()(note.updatedAt);
  const text = snippet(note.body, 140);

  function click(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) onOpen("open-new-tab");
    else if (e.altKey) onOpen("open-side");
    else onOpen("open");
  }

  return (
    <button
      type="button"
      data-note-row={note.id}
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
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
      onDoubleClick={() => onOpen("open-window")}
      onContextMenu={onMenu}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onOpen("open-new-tab");
        }
      }}
      className="list-row group relative flex w-full min-w-0 flex-col gap-0.5 px-2.5 py-[7px] text-start outline-none"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {note.color ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: note.color }} /> : null}
        <span
          className={cn("list-row-title min-w-0 flex-1 truncate text-[13px] leading-5", open || selected ? "font-semibold" : "font-medium")}
          style={{ unicodeBidi: "plaintext" }}
        >
          {note.title || t("notes.x.untitled")}
        </span>
        <span className="list-row-meta flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
          {note.archived ? <Archive aria-label={t("notes.x.archivedLabel")} className="size-3" /> : null}
          {note.indexError ? (
            <TriangleAlert aria-label={note.indexError} className="size-3" />
          ) : !note.indexed ? (
            <LoaderCircle aria-label={t("notes.x.indexing")} className="size-3 animate-spin" />
          ) : null}
          {when}
        </span>
      </span>
      <span dir="auto" className="list-row-meta truncate text-[12px] leading-[18px]">
        {text || "\u00a0"}
      </span>
    </button>
  );
});
