"use client"

// The notes editor's "Links" section: backlinks (notes whose [[wikilinks]] point here), related
// notes (through what this note names), and the note's graph edges (editable, shared with the
// graph inspector).
import { FileTextIcon, Link2Icon } from "lucide-react"

import { NodeLinks } from "@/components/graph/node-links"
import { useBacklinks, useRelated } from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import type { Note } from "@/lib/notes"

function NoteLinkRow({ id, title, meta, onOpen }: { id: string; title: string; meta?: string; onOpen: (id: string) => void }) {
  const { t } = useTranslations()
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(id)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-grid-soft"
      >
        <FileTextIcon className="size-3.5 shrink-0 text-grid-muted" />
        <span dir="auto" className="min-w-0 flex-1 truncate text-grid-fg">
          {title || t("notes.untitled")}
        </span>
        {meta ? <span className="shrink-0 text-[12px] text-grid-muted">{meta}</span> : null}
      </button>
    </li>
  )
}

export function NoteLinksSection({
  note,
  onOpenNote,
  onOpenEntity,
}: {
  note: Note
  onOpenNote: (id: string) => void
  onOpenEntity?: (e: { id: string; noteId?: string }) => void
}) {
  const { t, formatNumber } = useTranslations()
  const back = useBacklinks(note.id)
  const rel = useRelated(note.id)

  // Related: the notes reached through what this note names, de-duplicated.
  const related = new Map<string, { id: string; title: string; via: string }>()
  for (const r of rel.data ?? []) {
    if (r.noteId && r.noteId !== note.id && !related.has(r.noteId)) related.set(r.noteId, { id: r.noteId, title: r.name, via: r.relation })
    for (const n of r.notes) if (n.id !== note.id && !related.has(n.id)) related.set(n.id, { id: n.id, title: n.title, via: r.name })
  }
  const backlinks = back.data ?? []

  return (
    <section aria-label={t("notes.links")} className="space-y-5 border-t border-line px-6 py-5">
      <h2 className="grid-micro flex items-center gap-1.5">
        <Link2Icon className="size-3.5" /> {t("notes.links")}
      </h2>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="grid-micro mb-2">
            {t("notes.backlinks")} <span>{formatNumber(backlinks.length)}</span>
          </div>
          {backlinks.length === 0 ? (
            <p className="text-xs text-grid-muted">{back.isLoading ? t("common.loading") : t("notes.noBacklinks")}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {backlinks.map((b) => (
                <NoteLinkRow key={b.id} id={b.id} title={b.title} meta={b.category} onOpen={onOpenNote} />
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="grid-micro mb-2">
            {t("notes.related")} <span>{formatNumber(related.size)}</span>
          </div>
          {related.size === 0 ? (
            <p className="text-xs text-grid-muted">{rel.isLoading ? t("common.loading") : t("notes.noRelated")}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
              {[...related.values()].slice(0, 40).map((r) => (
                <NoteLinkRow key={r.id} id={r.id} title={r.title} meta={r.via} onOpen={onOpenNote} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {note.entityId ? (
        <NodeLinks
          namespace={note.namespace}
          entityId={note.entityId}
          onOpenNode={(e) => (e.noteId ? onOpenNote(e.noteId) : onOpenEntity?.(e))}
        />
      ) : null}
    </section>
  )
}
