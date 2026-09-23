"use client"

// A note's category = its graph node's entity type. The options are the brain's ontology entity
// types; "+ New category" swaps the select for an inline input (the server creates the type).
import { useMemo, useState } from "react"
import { CheckIcon, PlusIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOntology } from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const NEW = "__new__"

/** Lower snake-case, like the server's normalizeTypeName (it has the final word). */
export const normalizeType = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")

export function CategoryPicker({
  namespace,
  value,
  onChange,
  disabled,
  className,
  allowAll,
}: {
  namespace: string
  value: string
  /** `created` = the name is new to the ontology (send create_type). */
  onChange: (category: string, created: boolean) => void
  disabled?: boolean
  className?: string
  /** A filter: adds an "All categories" option whose value is "". */
  allowAll?: boolean
}) {
  const { t, formatNumber } = useTranslations()
  const onto = useOntology(namespace)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const ALL = "__all__"

  const types = useMemo(() => {
    const list = [...(onto.data?.entityTypes ?? [])].filter((x) => x.name !== "tag")
    if (value && !list.some((x) => x.name === value)) list.push({ name: value, description: "", count: 0, builtin: false })
    return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [onto.data, value])

  const items = useMemo(
    () => [
      ...(allowAll ? [{ value: ALL, label: t("graph.allCategories") }] : []),
      ...types.map((x) => ({ value: x.name, label: x.name })),
      ...(allowAll ? [] : [{ value: NEW, label: t("graph.newCategory") }]),
    ],
    [types, allowAll, t],
  )

  if (adding) {
    const commit = () => {
      const name = normalizeType(draft)
      if (!name) return
      setAdding(false)
      setDraft("")
      onChange(name, !types.some((x) => x.name === name))
    }
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Input
          autoFocus
          dir="auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape") setAdding(false)
          }}
          placeholder={t("graph.newCategoryPlaceholder")}
          aria-label={t("graph.newCategory")}
          className="h-7 w-40 text-xs"
        />
        <Button size="icon-sm" variant="ghost" onClick={commit} aria-label={t("common.save")}>
          <CheckIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setAdding(false)} aria-label={t("common.cancel")}>
          <XIcon />
        </Button>
      </div>
    )
  }

  return (
    <Select
      items={items}
      value={allowAll && !value ? ALL : value}
      disabled={disabled}
      onValueChange={(v) => {
        const s = String(v ?? "")
        if (s === NEW) setAdding(true)
        else onChange(s === ALL ? "" : s, false)
      }}
    >
      <SelectTrigger size="sm" aria-label={t("graph.category")} className={cn("h-7 min-w-32 text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? <SelectItem value={ALL}>{t("graph.allCategories")}</SelectItem> : null}
        {types.map((x) => (
          <SelectItem key={x.name} value={x.name}>
            <span dir="auto">{x.name}</span>
            {x.count ? <span className="ms-auto ps-3 text-[12px] text-grid-muted">{formatNumber(x.count)}</span> : null}
          </SelectItem>
        ))}
        {allowAll ? null : (
          <>
            <SelectSeparator />
            <SelectItem value={NEW}>
              <PlusIcon className="size-3.5" /> {t("graph.newCategory")}
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  )
}
