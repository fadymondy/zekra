"use client"

// A searchable picker over the brain's graph nodes (GET /api/brain/entities/search). Used by
// "+ Add link" in the node inspector and the notes editor.
import { useEffect, useState, type ReactNode } from "react"
import { Loader2Icon, SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useEntitySearch, type Entity } from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms)
    return () => clearTimeout(h)
  }, [value, ms])
  return v
}

/** The result list, shared by the popover picker and the `[[` autocomplete. */
export function EntityResults({
  namespace,
  query,
  exclude,
  active = -1,
  onPick,
  onResults,
}: {
  namespace: string
  query: string
  exclude?: string | null
  active?: number
  onPick: (e: Entity) => void
  onResults?: (list: Entity[]) => void
}) {
  const { t } = useTranslations()
  const q = useDebounced(query.trim(), 180)
  const res = useEntitySearch(namespace, q)
  const list = (res.data ?? []).filter((e) => e.id !== exclude && e.type !== "tag")
  useEffect(() => {
    onResults?.(list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data, exclude])

  if (res.isLoading && !res.data)
    return (
      <p className="flex items-center gap-2 px-2 py-2 text-xs text-grid-muted">
        <Loader2Icon className="size-3.5 animate-spin" /> {t("common.loading")}
      </p>
    )
  if (list.length === 0) return <p className="px-2 py-2 text-xs text-grid-muted">{t("graph.noNodesFound")}</p>
  return (
    <ul role="listbox" className="max-h-64 overflow-y-auto">
      {list.map((e, i) => (
        <li key={e.id} role="option" aria-selected={i === active}>
          <button
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick(e)}
            className={cn(
              "flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-grid-soft",
              i === active && "bg-grid-soft",
            )}
          >
            <span dir="auto" className="min-w-0 flex-1 truncate text-grid-fg">
              {e.name}
            </span>
            <span className="shrink-0 text-[12px] text-grid-muted">{e.type}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function EntityPicker({
  namespace,
  exclude,
  onPick,
  trigger,
}: {
  namespace: string
  exclude?: string | null
  onPick: (e: Entity) => void
  trigger: ReactNode
}) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent align="start" className="w-72 gap-2 rounded-none p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
          <Input
            autoFocus
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("graph.searchNodes")}
            aria-label={t("graph.searchNodes")}
            className="h-8 ps-7 text-xs"
          />
        </div>
        {open ? (
          <EntityResults
            namespace={namespace}
            query={q}
            exclude={exclude}
            onPick={(e) => {
              setOpen(false)
              setQ("")
              onPick(e)
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
