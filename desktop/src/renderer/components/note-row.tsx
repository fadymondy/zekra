import { memo, type MouseEvent } from "react";
import { Archive, LoaderCircle, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import { NoteIconTile } from "../features/editor/appearance-picker";
import { ago, rowSnippet } from "../features/notes/notes-model";
import type { Note } from "../lib/api";
import { useI18n } from "../lib/i18n";

/*
A note in the workspace's list column (MH-450) — a dense source-list row in
the shape of Notes / Linear:

  [▣] Title (semibold)                         2h
      the description, else one line of the body, muted

The tile is the note's icon on a wash of its colour (MH-308 override, else
its category's) — the mobile/web icon set. Title and snippet are user
content: dir="auto", so each reads, aligns and truncates in its OWN direction
(an English title in the Arabic UI ellipsizes at its end, not clipped at its
start); the tile and the date mirror with the UI. Archived / indexing /
index-error show as tiny glyphs by the time.

  click           open (replaces the preview tab)
  ⌘-click, middle open in a new tab
  ⌥-click         open to the side (split)
  double-click    rename: open it and select its title
                  (Open in New Window is ⌥⌘O / the menu)
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
  onOpen: (how: OpenHow | "open-window" | "rename") => void;
}) {
  const { t } = useI18n();
  const when = useListDate()(note.updatedAt);
  const text = rowSnippet(note, 140);

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
      onDoubleClick={() => onOpen("rename")}
      onContextMenu={onMenu}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onOpen("open-new-tab");
        }
      }}
      className="list-row group relative flex w-full min-w-0 items-start gap-2.5 px-2.5 py-[7px] text-start outline-none"
    >
      <NoteIconTile
        note={{ category: note.category, icon: note.icon, color: note.color }}
        className="mt-px size-7 rounded-md"
        iconClassName="size-3.5"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn("list-row-title min-w-0 flex-1 truncate text-[14px] leading-5", open || selected ? "font-semibold" : "font-medium")}
            dir="auto" style={{ unicodeBidi: "plaintext" }}
          >
            {note.title || t("notes.x.untitled")}
          </span>
          <span className="list-row-meta flex shrink-0 items-center gap-1 text-[12.5px] tabular-nums">
            {note.archived ? <Archive aria-label={t("notes.x.archivedLabel")} className="size-3" /> : null}
            {note.indexError ? (
              <TriangleAlert aria-label={note.indexError} className="size-3" />
            ) : !note.indexed ? (
              <LoaderCircle aria-label={t("notes.x.indexing")} className="size-3 animate-spin" />
            ) : null}
            {when}
          </span>
        </span>
        <span dir="auto" className="list-row-meta truncate text-[13px] leading-[19px]" style={{ unicodeBidi: "plaintext" }}>
          {text || "\u00a0"}
        </span>
      </span>
    </button>
  );
});
