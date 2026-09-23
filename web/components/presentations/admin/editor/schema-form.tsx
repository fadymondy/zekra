"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CopyIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react"
import { cn } from "cn"

import { ICON_NAMES } from "@/lib/presentations/icon-names"
import { blankLike, freshId, getIn, type Path } from "@/lib/presentations/edit-path"
import { move } from "@/lib/presentations/templates"
import type { SceneType } from "@/lib/presentations/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PresIcon } from "../../icon"

/*
The properties panel's forms. They are generated from the API's own JSON Schema for the
content (GET /api/presentations/catalog → schemas), so every slide, block, section and
screen-part type — and any the API adds later — gets proper controls: text and number
inputs, selects for enums, switches, an icon picker, an image field with a preview, and list
editors with add, duplicate, remove and reorder. A few shapes get a tuned control: tables
edit as a grid, chart series as number rows, and ids (workflow edges, map routes, the
highlighted step, an annotation's target) are picked from what exists instead of typed.
*/

export type Schema = {
  type?: string
  const?: unknown
  enum?: string[]
  description?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  oneOf?: Schema[]
  maxLength?: number
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  format?: string
}

type Obj = Record<string, unknown>
type T = (key: string, vars?: Record<string, string | number>) => string

export type FormCtx = {
  t: T
  dir: "ltr" | "rtl"
  /** The item being edited (a slide, a block, a section): ids are looked up in it. */
  root: unknown
  /** Path of `root` inside the content; errors and focus are content paths. */
  base: Path
  errors: Map<string, { message: string; hint?: string }>
  /** The field the caret is in on the canvas. */
  active: string
  set: (path: Path, value: unknown) => void
  scenes: SceneType[]
  /** Page previews an embed slide can point at. */
  pages: { id: string; title: string }[]
}

const humanize = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

export function fieldLabel(t: T, key: string): string {
  const k = `presentations.field.${key}`
  const v = t(k)
  return v === k ? humanize(key) : v
}

export function optionLabel(t: T, value: string): string {
  const k = `presentations.option.${value}`
  const v = t(k)
  return v === k ? humanize(value) : v
}

/** The schema of one item of a oneOf list, picked by its `type` constant. */
export function variantOf(list: Schema | undefined, type: unknown): Schema | undefined {
  return list?.oneOf?.find((s) => s.properties?.type?.const === type)
}

export const variantTypes = (list: Schema | undefined): string[] =>
  (list?.oneOf ?? []).map((s) => String(s.properties?.type?.const ?? "")).filter(Boolean)

// First the words people read, then the rest; notes and build close the form.
const ORDER = ["eyebrow", "title", "heading", "subtitle", "screen_title", "name", "label", "value", "price", "period", "quote", "author", "role", "body", "text", "description", "summary"]
const LAST = ["caption", "highlight", "focus", "legend", "transition", "build", "notes"]

function orderedKeys(schema: Schema): string[] {
  const keys = Object.keys(schema.properties ?? {}).filter((k) => k !== "type")
  const rank = (k: string) => {
    const a = ORDER.indexOf(k)
    if (a >= 0) return a
    const z = LAST.indexOf(k)
    if (z >= 0) return 1000 + z
    return (schema.required ?? []).includes(k) ? 100 : 200
  }
  return keys.map((k, i) => ({ k, r: rank(k) * 100 + i })).sort((a, b) => a.r - b.r).map((x) => x.k)
}

const LONG = new Set(["body", "text", "notes", "code", "summary", "quote", "description"])
const LTR = new Set(["url", "image_url", "cta_href", "code", "language", "id", "from", "to", "document_id"])

function ErrorLine({ ctx, path }: { ctx: FormCtx; path: Path }) {
  const e = ctx.errors.get(path.join("."))
  if (!e) return null
  return (
    <p className="text-xs text-destructive" role="alert" data-testid="field-error">
      {e.message}
      {e.hint ? <span className="text-destructive/80"> — {e.hint}</span> : null}
    </p>
  )
}

function Row({ ctx, path, label, hint, children, inline }: { ctx: FormCtx; path: Path; label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  const key = path.join(".")
  return (
    <div data-field-path={key} className={cn("grid min-w-0 grid-cols-1 gap-1 rounded-md", ctx.active === key && "bg-brand/5 ring-2 ring-brand/40 ring-offset-2 ring-offset-background", inline && "grid-cols-[minmax(0,1fr)_auto] items-center")}>
      <label className="text-xs font-medium text-muted-foreground" title={hint}>
        {label}
      </label>
      {children}
      <div className={inline ? "col-span-2" : undefined}>
        <ErrorLine ctx={ctx} path={path} />
      </div>
    </div>
  )
}

// ---- icon picker --------------------------------------------------------------

export function IconPicker({ value, onChange, t }: { value?: string; onChange: (v: string | undefined) => void; t: T }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? ICON_NAMES.filter((n) => n.includes(needle)) : ICON_NAMES
  }, [q])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="min-w-0 flex-1 justify-start gap-2 font-normal" data-testid="icon-picker">
              {value ? <PresIcon name={value} className="size-4 shrink-0" /> : <SearchIcon className="size-4 shrink-0 text-muted-foreground" />}
              <span className="truncate" dir="ltr">
                {value || t("presentations.editor.pickIcon")}
              </span>
            </Button>
          }
        />
        {value ? (
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(undefined)} aria-label={t("presentations.editor.clear")}>
            <XIcon />
          </Button>
        ) : null}
      </div>
      <PopoverContent className="w-80" align="start">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("presentations.editor.searchIcons")} aria-label={t("presentations.editor.searchIcons")} dir="ltr" />
        <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto" role="listbox" aria-label={t("presentations.field.icon")}>
          {found.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={n === value}
              title={n}
              onClick={() => {
                onChange(n)
                setOpen(false)
              }}
              className={cn("flex aspect-square items-center justify-center rounded-md border border-transparent hover:bg-muted", n === value && "border-brand bg-brand/10 text-brand")}
            >
              <PresIcon name={n} className="size-4" />
            </button>
          ))}
        </div>
        {found.length === 0 ? <p className="text-xs text-muted-foreground">{t("presentations.editor.noIcons")}</p> : null}
      </PopoverContent>
    </Popover>
  )
}

// ---- leaves -------------------------------------------------------------------

function Choice({ value, options, onChange, t, allowEmpty, labels }: { value: string; options: string[]; onChange: (v: string | undefined) => void; t: T; allowEmpty: boolean; labels?: Record<string, string> }) {
  const NONE = "__none__"
  const text = (v: string) => (v === NONE ? t("presentations.editor.default") : (labels?.[v] ?? optionLabel(t, v)))
  return (
    <Select value={value || (allowEmpty ? NONE : "")} onValueChange={(v) => onChange(v === NONE || v == null ? undefined : String(v))}>
      <SelectTrigger className="w-full" size="sm">
        <SelectValue>{(v) => (v ? text(String(v)) : "—")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowEmpty ? <SelectItem value={NONE}>{text(NONE)}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {text(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Ids a reference field can point at: the steps or markers of the nearest block that has them. */
function refOptions(ctx: FormCtx, rel: Path, key: string): { ids: string[]; labels: Record<string, string> } | null {
  const want = key === "vendor" || key === "driver" ? "markers" : key === "highlight" ? "steps" : null
  for (let n = rel.length; n >= 0; n--) {
    const at = getIn(ctx.root, rel.slice(0, n)) as Obj | undefined
    if (!at || typeof at !== "object") continue
    for (const listKey of want ? [want] : ["steps", "markers"]) {
      const list = at[listKey]
      if (!Array.isArray(list)) continue
      let items = list as Obj[]
      if (key === "vendor" || key === "driver") items = items.filter((m) => m.kind === key)
      const labels: Record<string, string> = {}
      for (const it of items) labels[String(it.id)] = String(it.title ?? it.label ?? it.id)
      return { ids: items.map((it) => String(it.id)).filter(Boolean), labels }
    }
  }
  return null
}

const REF_KEYS = new Set(["from", "to", "highlight", "vendor", "driver"])

function Leaf({ ctx, schema, value, rel, name, required }: { ctx: FormCtx; schema: Schema; value: unknown; rel: Path; name: string; required: boolean }) {
  const { t } = ctx
  const path = [...ctx.base, ...rel]
  const set = (v: unknown) => ctx.set(path, v === "" && !required ? undefined : v)
  const label = fieldLabel(t, name)
  const id = `pf-${path.join("-")}`

  if (schema.type === "boolean") {
    return (
      <Row ctx={ctx} path={path} label={label} hint={schema.description} inline>
        <Switch checked={value === undefined ? name === "build" : Boolean(value)} onCheckedChange={(v) => ctx.set(path, v)} aria-label={label} />
      </Row>
    )
  }
  if (schema.type === "number" || schema.type === "integer") {
    // Indexes into the block's own parts read better as a choice.
    if (name === "target_part_index" || name === "focus") {
      const parts = ((getIn(ctx.root, rel.slice(0, name === "focus" ? -1 : -3)) as Obj | undefined)?.parts as Obj[] | undefined) ?? []
      const labels: Record<string, string> = {}
      parts.forEach((p, i) => (labels[String(i)] = `${i + 1}. ${optionLabel(t, String(p.type))}${p.title ? ` — ${String(p.title)}` : ""}`))
      return (
        <Row ctx={ctx} path={path} label={label} hint={schema.description}>
          <Choice t={t} value={value === undefined ? "" : String(value)} options={parts.map((_, i) => String(i))} labels={labels} allowEmpty={!required} onChange={(v) => ctx.set(path, v === undefined ? undefined : Number(v))} />
        </Row>
      )
    }
    return (
      <Row ctx={ctx} path={path} label={label} hint={schema.description}>
        <Input
          id={id}
          type="number"
          dir="ltr"
          className="h-8"
          min={schema.minimum}
          max={schema.maximum}
          step="any"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => ctx.set(path, e.target.value === "" ? (required ? 0 : undefined) : Number(e.target.value))}
        />
      </Row>
    )
  }
  const str = typeof value === "string" ? value : ""
  if (schema.enum) {
    return (
      <Row ctx={ctx} path={path} label={label} hint={schema.description}>
        <Choice t={t} value={str} options={schema.enum} allowEmpty={!required} onChange={(v) => ctx.set(path, v)} />
      </Row>
    )
  }
  if (name === "icon") {
    return (
      <Row ctx={ctx} path={path} label={label} hint={schema.description}>
        <IconPicker t={t} value={str || undefined} onChange={(v) => ctx.set(path, v)} />
      </Row>
    )
  }
  if (name === "document_id") {
    const labels: Record<string, string> = {}
    ctx.pages.forEach((p) => (labels[p.id] = p.title))
    return (
      <Row ctx={ctx} path={path} label={t("presentations.embedPick")} hint={schema.description}>
        {ctx.pages.length ? <Choice t={t} value={str} options={ctx.pages.map((p) => p.id)} labels={labels} allowEmpty={false} onChange={(v) => ctx.set(path, v ?? "")} /> : <p className="text-xs text-muted-foreground">{t("presentations.embedNone")}</p>}
      </Row>
    )
  }
  if (REF_KEYS.has(name)) {
    const ref = refOptions(ctx, rel.slice(0, -1), name)
    if (ref && ref.ids.length) {
      const ids = str && !ref.ids.includes(str) ? [str, ...ref.ids] : ref.ids
      return (
        <Row ctx={ctx} path={path} label={label} hint={schema.description}>
          <Choice t={t} value={str} options={ids} labels={ref.labels} allowEmpty={!required} onChange={(v) => ctx.set(path, v ?? (required ? "" : undefined))} />
        </Row>
      )
    }
  }
  const isImage = name === "image_url" || (name === "url" && schema.format === "uri-reference" && "alt" in ((getIn(ctx.root, rel.slice(0, -1)) as Obj | undefined) ?? {}))
  const long = LONG.has(name) || (!LTR.has(name) && (schema.maxLength ?? 0) > 400)
  return (
    <Row ctx={ctx} path={path} label={label} hint={schema.description}>
      {long ? (
        <Textarea id={id} dir={LTR.has(name) ? "ltr" : ctx.dir} rows={name === "code" ? 8 : 3} maxLength={schema.maxLength} className={cn("min-h-16 text-sm", name === "code" && "font-mono text-xs")} value={str} onChange={(e) => set(e.target.value)} />
      ) : (
        <Input id={id} dir={LTR.has(name) ? "ltr" : ctx.dir} className="h-8" maxLength={schema.maxLength} value={str} placeholder={schema.description} onChange={(e) => set(e.target.value)} />
      )}
      {isImage && str ? (
        // eslint-disable-next-line @next/next/no-img-element -- a preview of the author's own URL
        <img src={str} alt="" className="mt-1 max-h-32 w-full rounded-md border bg-muted object-contain" data-testid="image-preview" />
      ) : null}
    </Row>
  )
}

// ---- lists --------------------------------------------------------------------

function itemSummary(item: unknown, t: T): string {
  if (typeof item === "string") return item
  if (!item || typeof item !== "object") return ""
  const o = item as Obj
  for (const k of ["title", "label", "name", "heading", "text", "id", "from"]) if (typeof o[k] === "string" && o[k]) return String(o[k]) + (k === "from" && o.to ? ` → ${String(o.to)}` : "")
  if (Array.isArray(o.cells)) return (o.cells as string[]).join(" · ")
  return o.type ? optionLabel(t, String(o.type)) : ""
}

function ListTools({ t, i, n, min, onMove, onDup, onRemove, canAdd }: { t: T; i: number; n: number; min: number; onMove: (to: number) => void; onDup?: () => void; onRemove: () => void; canAdd: boolean }) {
  return (
    <span className="flex shrink-0 items-center">
      <Button variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => onMove(i - 1)} aria-label={t("presentations.moveUp")}>
        <ArrowUpIcon />
      </Button>
      <Button variant="ghost" size="icon-xs" disabled={i === n - 1} onClick={() => onMove(i + 1)} aria-label={t("presentations.moveDown")}>
        <ArrowDownIcon />
      </Button>
      {onDup ? (
        <Button variant="ghost" size="icon-xs" disabled={!canAdd} onClick={onDup} aria-label={t("presentations.editor.duplicate")}>
          <CopyIcon />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-xs" disabled={n <= min} onClick={onRemove} aria-label={t("presentations.remove")}>
        <Trash2Icon />
      </Button>
    </span>
  )
}

/** A default for a new list item, from its schema: required fields filled, enums on their first value. */
export function defaultFor(schema: Schema | undefined, siblings: unknown[] = []): unknown {
  if (!schema) return ""
  if (schema.oneOf) return defaultFor(schema.oneOf[0], siblings)
  if (schema.const !== undefined) return schema.const
  if (schema.enum) return schema.enum[0]
  switch (schema.type) {
    case "string":
      return ""
    case "number":
    case "integer":
      return schema.minimum ?? 0
    case "boolean":
      return false
    case "array": {
      const n = schema.minItems ?? 0
      return Array.from({ length: n }, () => defaultFor(schema.items))
    }
    case "object": {
      const out: Obj = {}
      for (const k of schema.required ?? []) {
        const s = schema.properties?.[k]
        out[k] = k === "id" ? freshId(siblings) : k === "x" || k === "y" ? 50 : k === "r" ? 15 : defaultFor(s)
      }
      return out
    }
  }
  return ""
}

function Grid({ ctx, path, columns, rows, cellPath, setColumns, setRows, blankRow }: { ctx: FormCtx; path: Path; columns: string[]; rows: unknown[]; cellPath: (r: number, c: number) => Path; setColumns: (c: string[], drop?: number) => void; setRows: (r: unknown[]) => void; blankRow: () => unknown }) {
  const { t } = ctx
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2" data-testid="table-grid">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              {columns.map((c, j) => (
                <th key={j} className="border-b p-1 font-normal">
                  <div className="flex items-center gap-0.5">
                    <Input dir={ctx.dir} className="h-7 min-w-20 px-1.5 text-xs font-semibold" value={c} aria-label={`${fieldLabel(t, "columns")} ${j + 1}`} onChange={(e) => setColumns(columns.map((x, k) => (k === j ? e.target.value : x)))} />
                    <Button variant="ghost" size="icon-xs" disabled={columns.length <= 1} onClick={() => setColumns(columns.filter((_, k) => k !== j), j)} aria-label={t("presentations.editor.removeColumn")}>
                      <XIcon />
                    </Button>
                  </div>
                </th>
              ))}
              <th className="w-0 border-b p-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((_, i) => (
              <tr key={i}>
                {columns.map((__, j) => {
                  const cp = cellPath(i, j)
                  return (
                    <td key={j} className="p-1">
                      <Input dir={ctx.dir} className="h-7 min-w-20 px-1.5 text-xs" value={String(getIn(ctx.root, cp.slice(ctx.base.length)) ?? "")} aria-label={`${i + 1}:${j + 1}`} onChange={(e) => ctx.set(cp, e.target.value)} />
                    </td>
                  )
                })}
                <td className="p-1">
                  <ListTools t={t} i={i} n={rows.length} min={1} canAdd onMove={(to) => setRows(move(rows, i, to))} onRemove={() => setRows(rows.filter((__, k) => k !== i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="xs" onClick={() => setRows([...rows, blankRow()])}>
          <PlusIcon />
          {t("presentations.editor.addRow")}
        </Button>
        <Button variant="outline" size="xs" disabled={columns.length >= 8} onClick={() => setColumns([...columns, ""])}>
          <PlusIcon />
          {t("presentations.editor.addColumn")}
        </Button>
      </div>
      <ErrorLine ctx={ctx} path={path} />
    </div>
  )
}

function ListField({ ctx, schema, value, rel, name }: { ctx: FormCtx; schema: Schema; value: unknown; rel: Path; name: string }) {
  const { t } = ctx
  const path = [...ctx.base, ...rel]
  const list = Array.isArray(value) ? (value as unknown[]) : []
  const items = schema.items ?? {}
  const min = schema.minItems ?? 0
  const canAdd = schema.maxItems === undefined || list.length < schema.maxItems
  const [open, setOpen] = useState<number | null>(null)
  const [addType, setAddType] = useState("")
  const setList = (next: unknown[]) => ctx.set(path, next.length === 0 && min === 0 ? undefined : next)
  const label = fieldLabel(t, name)

  // The field on the canvas with the caret opens its item here.
  const activeIndex = useMemo(() => {
    const prefix = path.join(".") + "."
    if (!ctx.active.startsWith(prefix)) return null
    const n = Number(ctx.active.slice(prefix.length).split(".")[0])
    return Number.isInteger(n) ? n : null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the path is compared by value
  }, [ctx.active, path.join(".")])
  const shown = activeIndex ?? open

  const header = (extra?: ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold" title={schema.description}>
        {label} <span className="font-normal text-muted-foreground tabular-nums">{list.length}</span>
      </span>
      {extra}
    </div>
  )
  const parent = (getIn(ctx.root, rel.slice(0, -1)) ?? {}) as Obj

  // A table: columns with rows of cells, edited as a grid.
  if (name === "rows" && Array.isArray(parent.columns)) {
    const columns = parent.columns as string[]
    const objectRows = items.type === "object"
    const colPath = [...path.slice(0, -1), "columns"]
    return (
      <div className="grid min-w-0 grid-cols-1 gap-2" data-field-path={path.join(".")}>
        {header()}
        <Grid
          ctx={ctx}
          path={path}
          columns={columns}
          rows={list}
          cellPath={(r, c) => (objectRows ? [...path, r, "cells", c] : [...path, r, c])}
          blankRow={() => (objectRows ? { cells: columns.map(() => "") } : columns.map(() => ""))}
          setRows={setList}
          setColumns={(cols, drop) => {
            if (drop !== undefined) {
              const cut = (cells: unknown) => (Array.isArray(cells) ? cells.filter((_, k) => k !== drop) : cells)
              ctx.set(path.slice(0, -1), { ...parent, columns: cols, rows: list.map((r) => (objectRows ? { ...(r as Obj), cells: cut((r as Obj).cells) } : cut(r))) })
            } else ctx.set(colPath, cols)
          }}
        />
        {objectRows
          ? list.map((r, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-end gap-2 text-xs">
                <span className="pb-2 text-muted-foreground tabular-nums">{i + 1}</span>
                <Leaf ctx={ctx} schema={items.properties?.status ?? { type: "string" }} value={(r as Obj).status} rel={[...rel, i, "status"]} name="status" required={false} />
                <Leaf ctx={ctx} schema={items.properties?.tone ?? { type: "string" }} value={(r as Obj).tone} rel={[...rel, i, "tone"]} name="tone" required={false} />
              </div>
            ))
          : null}
      </div>
    )
  }
  if (name === "columns" && Array.isArray(parent.rows) && items.type === "string") return null // edited in the grid above

  // Numbers (a chart series): one row of inputs, labelled by the chart's labels.
  if (items.type === "number" || items.type === "integer") {
    const labels = (getIn(ctx.root, rel.slice(0, -3)) as Obj | undefined)?.labels as string[] | undefined
    return (
      <div className="grid min-w-0 grid-cols-1 gap-1" data-field-path={path.join(".")}>
        {header()}
        <div className="grid grid-cols-3 gap-1">
          {list.map((v, i) => (
            <label key={i} className="grid gap-0.5 text-[12px] text-muted-foreground">
              <span className="truncate">{labels?.[i] ?? i + 1}</span>
              <Input type="number" dir="ltr" step="any" className="h-7 px-1.5 text-xs" value={typeof v === "number" ? v : ""} onChange={(e) => setList(list.map((x, k) => (k === i ? Number(e.target.value) || 0 : x)))} />
            </label>
          ))}
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="xs" disabled={!canAdd} onClick={() => setList([...list, 0])}>
            <PlusIcon />
            {t("presentations.add")}
          </Button>
          <Button variant="outline" size="xs" disabled={list.length <= min} onClick={() => setList(list.slice(0, -1))}>
            <Trash2Icon />
            {t("presentations.remove")}
          </Button>
        </div>
        <ErrorLine ctx={ctx} path={path} />
      </div>
    )
  }

  // Bullets: a string, or {text, icon}.
  const bulletLike = items.oneOf?.some((s) => s.type === "string") && items.oneOf?.some((s) => s.properties?.text)
  if (items.type === "string" || bulletLike) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-1.5" data-field-path={path.join(".")}>
        {header()}
        {list.map((v, i) => {
          const text = typeof v === "string" ? v : String((v as Obj)?.text ?? "")
          const icon = typeof v === "string" ? undefined : ((v as Obj)?.icon as string | undefined)
          const ip = [...path, i]
          return (
            <div key={i} className="grid gap-1" data-field-path={ip.join(".")}>
              <div className={cn("flex items-center gap-1 rounded-md", (ctx.active === ip.join(".") || ctx.active === `${ip.join(".")}.text`) && "ring-2 ring-brand/40")}>
                {bulletLike ? (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button variant="outline" size="icon-sm" aria-label={t("presentations.field.icon")}>
                          {icon ? <PresIcon name={icon} className="size-4" /> : <span className="size-1.5 rounded-full bg-brand" />}
                        </Button>
                      }
                    />
                    <PopoverContent className="w-64" align="start">
                      <IconPicker t={t} value={icon} onChange={(ic) => setList(list.map((x, k) => (k === i ? (ic ? { text, icon: ic } : text) : x)))} />
                    </PopoverContent>
                  </Popover>
                ) : null}
                <Input dir={ctx.dir} className="h-8 min-w-0 flex-1" value={text} maxLength={items.maxLength} aria-label={`${label} ${i + 1}`} onChange={(e) => setList(list.map((x, k) => (k === i ? (typeof x === "string" ? e.target.value : { ...(x as Obj), text: e.target.value }) : x)))} />
                <ListTools t={t} i={i} n={list.length} min={min} canAdd={canAdd} onMove={(to) => setList(move(list, i, to))} onRemove={() => setList(list.filter((_, k) => k !== i))} />
              </div>
              <ErrorLine ctx={ctx} path={ip} />
              <ErrorLine ctx={ctx} path={[...ip, "text"]} />
            </div>
          )
        })}
        <Button variant="outline" size="xs" className="justify-self-start" disabled={!canAdd} onClick={() => setList([...list, ""])}>
          <PlusIcon />
          {t("presentations.add")}
        </Button>
        <ErrorLine ctx={ctx} path={path} />
      </div>
    )
  }

  // Objects (kpis, steps, markers, routes, nav, plans…) and typed parts.
  const types = variantTypes(items)
  const schemaFor = (item: unknown) => (types.length ? variantOf(items, (item as Obj)?.type) : items)
  const add = () => {
    const s = types.length ? variantOf(items, addType || types[0]) : items
    const sample = list[list.length - 1]
    const made = defaultFor(s, list) as Obj
    // Keep optional text fields the siblings use, so the new card looks like them.
    if (!types.length && sample && typeof sample === "object") for (const [k, v] of Object.entries(blankLike(sample) as Obj)) if (!(k in made) && typeof v === "string" && k !== "icon" && k !== "tone" && k !== "kind") made[k] = ""
    for (const [k, v] of Object.entries(made)) if (v === "" && !(s?.required ?? []).includes(k)) delete made[k]
    setList([...list, made])
    setOpen(list.length)
  }
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5" data-field-path={path.join(".")}>
      {header()}
      {list.map((item, i) => {
        const ip = [...path, i]
        const bad = [...ctx.errors.keys()].some((k) => k === ip.join(".") || k.startsWith(ip.join(".") + "."))
        const isOpen = shown === i
        return (
          <div key={i} className={cn("rounded-md border", bad && "border-destructive/60")} data-testid="list-item">
            <div className="flex items-center gap-1 p-1">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-start text-xs" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
                <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform", !isOpen && "-rotate-90 rtl:rotate-90")} />
                {types.length ? <Badge variant="secondary">{optionLabel(t, String((item as Obj)?.type))}</Badge> : <span className="text-muted-foreground tabular-nums">{i + 1}</span>}
                <span className="truncate" dir="auto">
                  {itemSummary(item, t)}
                </span>
              </button>
              <ListTools
                t={t}
                i={i}
                n={list.length}
                min={min}
                canAdd={canAdd}
                onMove={(to) => setList(move(list, i, to))}
                onDup={() => {
                  const copy = JSON.parse(JSON.stringify(item)) as Obj
                  if (copy && typeof copy === "object" && "id" in copy) copy.id = freshId(list, String(copy.id).replace(/-\d+$/, "") || "item")
                  setList([...list.slice(0, i + 1), copy, ...list.slice(i + 1)])
                }}
                onRemove={() => setList(list.filter((_, k) => k !== i))}
              />
            </div>
            {isOpen ? (
              <div className="border-t p-2">
                <ObjectFields ctx={ctx} schema={schemaFor(item)} value={item} rel={[...rel, i]} />
              </div>
            ) : null}
          </div>
        )
      })}
      <div className="flex items-center gap-1">
        {types.length > 1 ? (
          <div className="w-36">
            <Choice t={t} value={addType || types[0]} options={types} allowEmpty={false} onChange={(v) => setAddType(v ?? types[0])} />
          </div>
        ) : null}
        <Button variant="outline" size="xs" disabled={!canAdd} onClick={add} data-testid={`add-${name}`}>
          <PlusIcon />
          {t("presentations.add")}
        </Button>
      </div>
      <ErrorLine ctx={ctx} path={path} />
    </div>
  )
}

// ---- scenes -------------------------------------------------------------------

function SceneParams({ ctx, value, rel }: { ctx: FormCtx; value: Obj; rel: Path }) {
  const scene = ctx.scenes.find((s) => s.type === value.type)
  const params = (value.params ?? {}) as Obj
  if (!scene) return null
  const props: Record<string, Schema> = {}
  const complex: string[] = []
  for (const p of scene.params) {
    if (p.enum) props[p.name] = { type: "string", enum: p.enum, description: p.description }
    else if (p.kind === "integer" || p.kind === "number") props[p.name] = { type: "number", minimum: p.min, maximum: p.max, description: p.description }
    else if (p.kind === "boolean" || p.kind === "bool") props[p.name] = { type: "boolean", description: p.description }
    else if (p.kind === "string" || p.kind === "text") props[p.name] = { type: "string", description: p.description }
    else complex.push(p.name)
  }
  return (
    <div className="grid gap-2">
      <ObjectFields ctx={ctx} schema={{ type: "object", properties: props }} value={params} rel={[...rel, "params"]} />
      {complex.length ? <p className="text-xs text-muted-foreground">{ctx.t("presentations.editor.advancedOnly", { fields: complex.join(", ") })}</p> : null}
    </div>
  )
}

// ---- objects ------------------------------------------------------------------

export function ObjectFields({ ctx, schema, value, rel, skip }: { ctx: FormCtx; schema: Schema | undefined; value: unknown; rel: Path; skip?: string[] }) {
  const { t } = ctx
  if (!schema?.properties) return <p className="text-xs text-muted-foreground">{t("presentations.editor.noSchema")}</p>
  const obj = (value && typeof value === "object" ? value : {}) as Obj
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      {orderedKeys(schema)
        .filter((k) => !skip?.includes(k))
        .map((k) => {
          const s = schema.properties![k]
          const required = (schema.required ?? []).includes(k)
          const r = [...rel, k]
          if (s.type === "array") return <ListField key={k} ctx={ctx} schema={s} value={obj[k]} rel={r} name={k} />
          const nested = s.oneOf ? (variantOf(s, (obj[k] as Obj | undefined)?.type) ?? s.oneOf[0]) : s
          if (s.type === "object" || s.oneOf) {
            const present = obj[k] !== undefined
            const types = variantTypes(s)
            return (
              <fieldset key={k} className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-2" data-field-path={[...ctx.base, ...r].join(".")}>
                <legend className="flex items-center gap-2 px-1 text-xs font-semibold" title={s.description}>
                  {fieldLabel(t, k)}
                  {!required ? (
                    <Switch
                      checked={present}
                      aria-label={fieldLabel(t, k)}
                      onCheckedChange={(on) => ctx.set([...ctx.base, ...r], on ? (k === "scene" ? { type: ctx.scenes[0]?.type ?? "particles", params: {} } : defaultFor(nested)) : undefined)}
                    />
                  ) : null}
                </legend>
                {present ? (
                  <>
                    {types.length > 1 ? (
                      <Choice t={t} value={String((obj[k] as Obj).type ?? "")} options={types} allowEmpty={false} onChange={(v) => ctx.set([...ctx.base, ...r], defaultFor(variantOf(s, v)))} />
                    ) : null}
                    {k === "scene" ? (
                      <>
                        <Leaf ctx={ctx} schema={s.properties?.type ?? { type: "string" }} value={(obj[k] as Obj).type} rel={[...r, "type"]} name="scene_type" required />
                        <SceneParams ctx={ctx} value={obj[k] as Obj} rel={r} />
                      </>
                    ) : (
                      <ObjectFields ctx={ctx} schema={nested} value={obj[k]} rel={r} />
                    )}
                  </>
                ) : null}
                <ErrorLine ctx={ctx} path={[...ctx.base, ...r]} />
              </fieldset>
            )
          }
          return <Leaf key={k} ctx={ctx} schema={s} value={obj[k]} rel={r} name={k} required={required} />
        })}
    </div>
  )
}
