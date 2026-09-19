"use client"

// A searchable tag combobox: the brain's tags sorted by how many notes carry them. Used as the
// notes list's Tags filter (multi-select) and as the editor's "add tag" picker (can create).
import { useMemo, useState, type ReactElement } from "react"
import { CheckIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslations } from "@/lib/i18n"
import { useNoteTagCounts } from "@/lib/notes"
import { cn } from "@/lib/utils"

export function TagCombobox({
  namespace,
  selected,
  onToggle,
  onClear,
  allowCreate,
  trigger,
  align = "start",
}: {
  namespace: string
  selected: string[]
  onToggle: (tag: string) => void
  onClear?: () => void
  allowCreate?: boolean
  trigger: ReactElement
  align?: "start" | "end" | "center"
}) {
  const { t, formatNumber } = useTranslations()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const counts = useNoteTagCounts(namespace, open)

  const list = useMemo(() => {
    const all = counts.data ?? []
    const known = new Set(all.map((x) => x.tag))
    const extra = selected.filter((s) => !known.has(s)).map((tag) => ({ tag, count: 0 }))
    const needle = q.trim().toLowerCase()
    return [...extra, ...all].filter((x) => !needle || x.tag.toLowerCase().includes(needle)).slice(0, 200)
  }, [counts.data, selected, q])

  const draft = q.trim().replace(/,/g, "")
  const canCreate = allowCreate && draft && !list.some((x) => x.tag === draft)

  const pick = (tag: string) => {
    onToggle(tag)
    if (allowCreate) setQ("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ("")
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align={align} className="w-64 gap-0 rounded-none p-0">
        <div className="relative border-b border-line">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
          <Input
            autoFocus
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (canCreate) pick(draft)
                else if (list[0]) pick(list[0].tag)
              }
            }}
            placeholder={allowCreate ? t("notes.tagAddPlaceholder") : t("notes.tagSearch")}
            aria-label={t("notes.tagSearch")}
            className="h-9 rounded-none border-0 ps-8 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
        <ul role="listbox" aria-multiselectable className="max-h-72 overflow-y-auto py-1">
          {canCreate ? (
            <li>
              <button
                type="button"
                onClick={() => pick(draft)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs hover:bg-grid-soft"
              >
                <PlusIcon className="size-3.5 text-grid-muted" />
                {t("notes.tagCreate", { tag: draft })}
              </button>
            </li>
          ) : null}
          {counts.isLoading && !counts.data ? (
            <li className="flex items-center gap-2 px-2.5 py-2 text-xs text-grid-muted">
              <Loader2Icon className="size-3.5 animate-spin" /> {t("common.loading")}
            </li>
          ) : list.length === 0 && !canCreate ? (
            <li className="px-2.5 py-2 text-xs text-grid-muted">{t("notes.tagNone")}</li>
          ) : (
            list.map((x) => {
              const on = selected.includes(x.tag)
              return (
                <li key={x.tag} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => pick(x.tag)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs hover:bg-grid-soft"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center border border-line",
                        on && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {on ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <bdi className="min-w-0 flex-1 truncate text-grid-fg">{x.tag}</bdi>
                    {x.count ? <span className="shrink-0 text-[10px] text-grid-muted">{formatNumber(x.count)}</span> : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
        {onClear && selected.length ? (
          <div className="border-t border-line p-1">
            <button
              type="button"
              onClick={onClear}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-start text-xs text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
            >
              <XIcon className="size-3" /> {t("notes.clearSelection")}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
