"use client"

import { memo } from "react"
import { ArchiveIcon, AlertTriangleIcon, Loader2Icon } from "lucide-react"

import { useTranslations } from "@/lib/i18n"
import type { Note } from "@/lib/notes"
import { listDate, rowSnippet } from "@/lib/notes/note-groups"
import { noteIcon } from "@/lib/notes/note-icon"
import { cn } from "@/lib/utils"

import { NoteRowActions, type NoteRowAction } from "./note-row-actions"

/** A note's icon on a wash of its colour (MH-308 override, else its category's). */
export function NoteTile({ note, className, iconClassName }: {
  note: Pick<Note, "category" | "icon" | "color">
  className?: string
  iconClassName?: string
}) {
  const { Icon, color } = noteIcon({ category: note.category || "note", icon: note.icon, color: note.color })
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center", className)}
      style={{ color, background: `color-mix(in oklab, ${color} 15%, transparent)` }}
    >
      <Icon className={cn("stroke-[1.75]", iconClassName)} />
    </span>
  )
}

/*
A note in the list — the desktop app's row (desktop/src/renderer/components/
note-row.tsx), in the shape of Notes / Linear:

  [▣] Title (semibold)                         9:41
      the description, else one line of the body, muted

Title and snippet are user content (dir="auto": each reads and truncates in
its own direction); the tile and the date mirror with the UI. Right-click
(and swipe on touch) opens pin / archive / delete / icon & colour.
*/
export const NoteListRow = memo(function NoteListRow({ note, selected, onSelect, onAction, onAppearance }: {
  note: Note
  selected: boolean
  onSelect: () => void
  onAction: (action: NoteRowAction) => void
  onAppearance: (patch: { icon?: string; color?: string }) => void
}) {
  const { t, locale } = useTranslations()
  const when = listDate(note.updatedAt, locale === "ar" ? "ar" : "en", t("notes.grp.yesterday"))
  const text = rowSnippet(note)
  return (
    <NoteRowActions
      pinned={note.pinned}
      archived={note.archived}
      title={note.title}
      icon={note.icon}
      color={note.color}
      category={note.category || "note"}
      onAction={onAction}
      onAppearance={onAppearance}
    >
      <button
        type="button"
        data-note-row={note.id}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "group flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none transition-colors",
          "hover:bg-[color-mix(in_oklab,var(--grid-fg)_5%,transparent)] focus-visible:ring-2 focus-visible:ring-grid-action/50",
          selected && "bg-grid-action text-grid-on-action hover:bg-grid-action",
        )}
      >
        <NoteTile
          note={note}
          className={cn("mt-px size-7 rounded-md", selected && "!bg-white/20 !text-grid-on-action")}
          iconClassName="size-3.5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span dir="auto" className="min-w-0 flex-1 truncate text-[14px] leading-5 font-semibold" style={{ unicodeBidi: "plaintext" }}>
              {note.title || t("notes.untitled")}
            </span>
            <span className={cn("flex shrink-0 items-center gap-1 text-[12.5px] tabular-nums", selected ? "opacity-80" : "text-grid-muted")}>
              {note.archived ? <ArchiveIcon aria-label={t("notes.archived")} className="size-3" /> : null}
              {note.indexError ? (
                <AlertTriangleIcon aria-label={t("notes.notIndexed")} className="size-3" />
              ) : !note.indexed ? (
                <Loader2Icon aria-label={t("notes.indexing")} className="size-3 animate-spin" />
              ) : null}
              {when}
            </span>
          </span>
          <span dir="auto" className={cn("truncate text-[13px] leading-[19px]", selected ? "opacity-80" : "text-grid-muted")} style={{ unicodeBidi: "plaintext" }}>
            {text || " "}
          </span>
        </span>
      </button>
    </NoteRowActions>
  )
})
