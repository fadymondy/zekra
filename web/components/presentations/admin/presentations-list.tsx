"use client"

// A brain's presentations: decks, reports and page previews, filterable by kind, status and
// customer, with view counts and live links. "New" creates a valid starter document; "From
// brain" asks the API to draft one from notes, a recall query, a graph entity or the whole
// brain. Everything starts as a draft and stays private until a share link is created.
// Contract: GET/POST /api/presentations (?namespace=), POST /api/presentations/from-brain.
import { useCallback, useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import {
  BrainIcon, CheckIcon, EyeIcon, FileTextIcon, LayoutTemplateIcon, Link2Icon, Loader2Icon, NetworkIcon, PlusIcon,
  PresentationIcon, SearchIcon, SparklesIcon, StickyNoteIcon,
} from "lucide-react"

import { Ltr } from "@/components/copy-field"
import { EntityResults } from "@/components/graph/entity-picker"
import { RowList, SectionHeader } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, ApiError as ConsoleApiError } from "@/lib/api"
import type { Entity } from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import type { NotePage } from "@/lib/notes"
import { ApiError, createFromBrain, createPresentation, listPresentations, type ListFilter } from "@/lib/presentations/api"
import { presentationsHref } from "@/lib/presentations/href"
import { starter } from "@/lib/presentations/templates"
import {
  KINDS, STATUSES, STYLE_KEYS, type FromBrainSource, type Kind, type PLocale, type Summary,
} from "@/lib/presentations/types"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

export const KIND_ICONS = { deck: PresentationIcon, report: FileTextIcon, page: LayoutTemplateIcon } as const

const ALL = "__all"

export function PresentationsList({ locale, namespace }: { locale: string; namespace?: string }) {
  const { t, formatDate, formatNumber } = useTranslations()
  useDocumentTitle(namespace ? `${t("presentations.title")} · ${namespace}` : t("presentations.title"))
  const [items, setItems] = useState<Summary[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [filter, setFilter] = useState<ListFilter>({})
  const [q, setQ] = useState("")

  const load = useCallback(
    async (f: ListFilter) => {
      try {
        setItems(await listPresentations({ ...f, namespace }))
        setError(null)
      } catch (err) {
        // ErrorState speaks the console's ApiError (status-aware messages).
        setError(err instanceof ApiError ? new ConsoleApiError(err.status, err.message) : err)
      }
    },
    [namespace],
  )

  useEffect(() => {
    const id = setTimeout(() => void load({ ...filter, q }), 250)
    return () => clearTimeout(id)
  }, [filter, q, load])

  const customers = useMemo(() => {
    const set = new Set<string>()
    for (const i of items ?? []) {
      const c = i.customer.company || i.customer.name
      if (c) set.add(c)
    }
    return [...set].sort()
  }, [items])

  const when = (iso: string | null) => (iso ? formatDate(iso, { dateStyle: "medium", timeStyle: "short" }) : t("presentations.never"))
  const hrefOf = (i: Summary) => presentationsHref(locale, namespace ?? i.namespace, i.id)

  const actions = namespace ? (
    <div className="flex flex-wrap gap-2">
      <FromBrain locale={locale} namespace={namespace} />
      <NewPresentation locale={locale} namespace={namespace} />
    </div>
  ) : undefined

  return (
    <>
      <SectionHeader
        micro={namespace ? <Ltr>{namespace}</Ltr> : t("presentations.eyebrow")}
        title={t("presentations.title")}
        description={t("presentations.mcpHint")}
        action={actions}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" aria-hidden />
          <Input
            dir="auto"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("presentations.search")}
            aria-label={t("presentations.search")}
            className="ps-8"
          />
        </div>
        <Select value={filter.kind || ALL} onValueChange={(v) => setFilter((f) => ({ ...f, kind: v === ALL ? "" : (v as Kind) }))}>
          <SelectTrigger className="w-36" aria-label={t("presentations.filter.kind")}>
            <SelectValue>{(v) => (v === ALL ? t("presentations.filter.allKinds") : t(`presentations.kind.${String(v)}`))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("presentations.filter.allKinds")}</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`presentations.kind.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.status || ALL} onValueChange={(v) => setFilter((f) => ({ ...f, status: v === ALL ? "" : (v as Summary["status"]) }))}>
          <SelectTrigger className="w-36" aria-label={t("presentations.filter.status")}>
            <SelectValue>{(v) => (v === ALL ? t("presentations.filter.allStatuses") : t(`presentations.status.${String(v)}`))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("presentations.filter.allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`presentations.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.customer || ALL} onValueChange={(v) => setFilter((f) => ({ ...f, customer: v === ALL ? "" : String(v) }))}>
          <SelectTrigger className="w-44" aria-label={t("presentations.filter.customer")}>
            <SelectValue>{(v) => (v === ALL ? t("presentations.filter.allCustomers") : String(v))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("presentations.filter.allCustomers")}</SelectItem>
            {(filter.customer && !customers.includes(filter.customer) ? [filter.customer, ...customers] : customers).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : items === null ? (
        <LoadingRows rows={4} />
      ) : items.length === 0 ? (
        <EmptyState title={t("presentations.empty.title")} body={t("presentations.empty.body")} action={actions} />
      ) : (
        <RowList label={t("presentations.title")}>
          {items.map((i) => {
            const Icon = KIND_ICONS[i.kind]
            return (
              <li key={i.id} data-testid="presentation-row">
                <a href={hrefOf(i)} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 text-sm transition-colors hover:bg-grid-soft">
                  <Icon className="size-4 shrink-0 text-grid-muted" aria-label={t(`presentations.kind.${i.kind}`)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-grid-fg" dir="auto">
                      {i.title || t("presentations.untitled")}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-grid-muted">
                      <span>{t(`presentations.kind.${i.kind}`)}</span>
                      <Ltr>{(i.locales ?? [i.locale]).map((l) => l.toUpperCase()).join(" / ")}</Ltr>
                      {!namespace && i.namespace ? <Ltr>{i.namespace}</Ltr> : null}
                      {i.customer.company || i.customer.name ? (
                        <bdi>{[i.customer.company, i.customer.name].filter(Boolean).join(" · ")}</bdi>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={i.status === "ready" ? "default" : "outline"}>{t(`presentations.status.${i.status}`)}</Badge>
                    {i.active_shares > 0 ? (
                      <Badge variant="secondary" title={t("presentations.share.links")}>
                        <Link2Icon />
                        {formatNumber(i.active_shares)}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="inline-flex w-16 items-center justify-end gap-1 text-grid-muted tabular-nums" title={t("presentations.col.views")}>
                    <EyeIcon className="size-3.5" aria-hidden />
                    {formatNumber(i.view_count)}
                  </span>
                  <span className="hidden w-40 text-end text-[11px] text-grid-muted md:block" title={t("presentations.col.lastViewed")}>
                    {when(i.last_viewed_at)}
                  </span>
                </a>
              </li>
            )
          })}
        </RowList>
      )}
    </>
  )
}

// ---- shared form parts ---------------------------------------------------------

type Meta = { kind: Kind; lang: PLocale; name: string; company: string; email: string; style: string }

function useMeta(locale: string) {
  return useState<Meta>({ kind: "deck", lang: locale === "ar" ? "ar" : "en", name: "", company: "", email: "", style: "minimal" })
}

function MetaFields({ meta, set, prefix, withStyle }: { meta: Meta; set: (m: Meta) => void; prefix: string; withStyle?: boolean }) {
  const { t } = useTranslations()
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${prefix}-kind`}>{t("presentations.col.kind")}</FieldLabel>
          <Select value={meta.kind} onValueChange={(v) => set({ ...meta, kind: (v as Kind) ?? "deck" })}>
            <SelectTrigger id={`${prefix}-kind`} className="w-full">
              <SelectValue>{(v) => t(`presentations.kind.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`presentations.kind.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-locale`}>{t("presentations.language")}</FieldLabel>
          <Select value={meta.lang} onValueChange={(v) => set({ ...meta, lang: (v as PLocale) ?? "en" })}>
            <SelectTrigger id={`${prefix}-locale`} className="w-full">
              <SelectValue>{(v) => t(`presentations.locale.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("presentations.locale.en")}</SelectItem>
              <SelectItem value="ar">{t("presentations.locale.ar")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${prefix}-company`}>{t("presentations.customer.company")}</FieldLabel>
          <Input id={`${prefix}-company`} dir="auto" value={meta.company} onChange={(e) => set({ ...meta, company: e.target.value })} maxLength={120} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-name`}>{t("presentations.customer.name")}</FieldLabel>
          <Input id={`${prefix}-name`} dir="auto" value={meta.name} onChange={(e) => set({ ...meta, name: e.target.value })} maxLength={120} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${prefix}-email`}>{t("presentations.customer.email")}</FieldLabel>
        <Input id={`${prefix}-email`} type="email" dir="ltr" value={meta.email} onChange={(e) => set({ ...meta, email: e.target.value })} />
      </Field>
      {withStyle ? (
        <Field>
          <FieldLabel htmlFor={`${prefix}-style`}>{t("presentations.style")}</FieldLabel>
          <Select value={meta.style} onValueChange={(v) => set({ ...meta, style: String(v ?? "minimal") })}>
            <SelectTrigger id={`${prefix}-style`} className="w-full">
              <SelectValue>{(v) => t(`presentations.styleName.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STYLE_KEYS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`presentations.styleName.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("presentations.fromBrain.styleHelp")}</FieldDescription>
        </Field>
      ) : null}
    </>
  )
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null
}

// ---- New (blank starter) -------------------------------------------------------------

function NewPresentation({ locale, namespace }: { locale: string; namespace: string }) {
  const { t } = useTranslations()
  const [meta, setMeta] = useMeta(locale)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const doc = await createPresentation({
        namespace,
        kind: meta.kind,
        locale: meta.lang,
        customer: { name: meta.name, company: meta.company, email: meta.email },
        content: starter(meta.kind, title.trim() || t("presentations.untitled")),
      })
      window.location.href = presentationsHref(locale, namespace, doc.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <PlusIcon />
        {t("presentations.new")}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{t("presentations.new")}</DialogTitle>
            <DialogDescription>{t("presentations.newHelp")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="np-title">{t("presentations.col.title")}</FieldLabel>
              <Input id="np-title" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </Field>
            <MetaFields meta={meta} set={setMeta} prefix="np" />
          </FieldGroup>
          <FormError error={error} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("presentations.cancel")}</DialogClose>
            <Button type="submit" disabled={busy || (!meta.name.trim() && !meta.company.trim())}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {t("presentations.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- From brain (notes / search / entity / whole brain) -------------------------------

type SourceType = FromBrainSource["type"]
const SOURCE_TYPES: { type: SourceType; icon: typeof StickyNoteIcon }[] = [
  { type: "notes", icon: StickyNoteIcon },
  { type: "search", icon: SearchIcon },
  { type: "entity", icon: NetworkIcon },
  { type: "brain", icon: BrainIcon },
]

function FromBrain({ locale, namespace }: { locale: string; namespace: string }) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const [meta, setMeta] = useMeta(locale)
  const [type, setType] = useState<SourceType>("notes")
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [entity, setEntity] = useState<Entity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const source: FromBrainSource | null =
    type === "notes"
      ? noteIds.length
        ? { type, note_ids: noteIds }
        : null
      : type === "search"
        ? query.trim()
          ? { type, query: query.trim() }
          : null
        : type === "entity"
          ? entity
            ? { type, entity: entity.id }
            : null
          : { type: "brain" }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      const doc = await createFromBrain({
        namespace,
        source,
        kind: meta.kind,
        locale: meta.lang,
        customer: { name: meta.name, company: meta.company, email: meta.email },
        style: meta.style,
      })
      window.location.href = presentationsHref(locale, namespace, doc.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <SparklesIcon />
        {t("presentations.fromBrain.open")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{t("presentations.fromBrain.title")}</DialogTitle>
            <DialogDescription>{t("presentations.fromBrain.help")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65dvh] overflow-y-auto pe-1">
            <FieldGroup>
              <Field>
                <FieldLabel>{t("presentations.fromBrain.source")}</FieldLabel>
                <ToggleGroup
                  aria-label={t("presentations.fromBrain.source")}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={[type]}
                  onValueChange={(v: string[]) => v[0] && setType(v[0] as SourceType)}
                  className="flex-wrap"
                >
                  {SOURCE_TYPES.map(({ type: st, icon: Icon }) => (
                    <ToggleGroupItem key={st} value={st}>
                      <Icon />
                      {t(`presentations.fromBrain.source.${st}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              {type === "notes" ? (
                <NotePicker namespace={namespace} selected={noteIds} onChange={setNoteIds} />
              ) : type === "search" ? (
                <Field>
                  <FieldLabel htmlFor="fb-q">{t("presentations.fromBrain.query")}</FieldLabel>
                  <Input id="fb-q" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("presentations.fromBrain.queryPlaceholder")} maxLength={300} />
                  <FieldDescription>{t("presentations.fromBrain.queryHelp")}</FieldDescription>
                </Field>
              ) : type === "entity" ? (
                <EntityField namespace={namespace} value={entity} onChange={setEntity} />
              ) : (
                <p className="border border-line bg-grid-card px-3 py-2 text-sm text-grid-muted">{t("presentations.fromBrain.brainHelp")}</p>
              )}

              <MetaFields meta={meta} set={setMeta} prefix="fb" withStyle />
            </FieldGroup>
          </div>
          <p className="text-xs text-grid-muted">{t("presentations.fromBrain.draftNote")}</p>
          <FormError error={error} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("presentations.cancel")}</DialogClose>
            <Button type="submit" disabled={busy || !source || (!meta.name.trim() && !meta.company.trim())}>
              {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              {busy ? t("presentations.fromBrain.working") : t("presentations.fromBrain.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NotePicker({ namespace, selected, onChange }: { namespace: string; selected: string[]; onChange: (ids: string[]) => void }) {
  const { t, timeAgo } = useTranslations()
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(h)
  }, [search])
  const sp = new URLSearchParams({ namespace, limit: "40" })
  if (q) sp.set("q", q)
  const { data, error, isLoading } = useSWR<NotePage>(`/api/notes?${sp}`, (k: string) => api<NotePage>(k))
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  return (
    <Field>
      <FieldLabel htmlFor="fb-notes">{t("presentations.fromBrain.notes")}</FieldLabel>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" aria-hidden />
        <Input id="fb-notes" dir="auto" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("presentations.fromBrain.notesSearch")} className="ps-8" />
      </div>
      <div className="max-h-56 overflow-y-auto border border-line">
        {error ? (
          <p className="px-3 py-2 text-xs text-grid-danger-text">{t("common.networkError")}</p>
        ) : isLoading && !data ? (
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-grid-muted">
            <Loader2Icon className="size-3.5 animate-spin" /> {t("common.loading")}
          </p>
        ) : !data?.notes?.length ? (
          <p className="px-3 py-2 text-xs text-grid-muted">{t("presentations.fromBrain.noNotes")}</p>
        ) : (
          <ul className="divide-y divide-line" role="listbox" aria-multiselectable aria-label={t("presentations.fromBrain.notes")}>
            {data.notes.map((n) => {
              const on = selected.includes(n.id)
              return (
                <li key={n.id} role="option" aria-selected={on}>
                  <button type="button" onClick={() => toggle(n.id)} className={cn("flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-grid-soft", on && "bg-grid-soft")}>
                    <span className={cn("flex size-4 shrink-0 items-center justify-center border", on ? "border-grid-fg bg-grid-fg text-grid-bg" : "border-line")}>
                      {on ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {n.title || t("presentations.untitled")}
                    </span>
                    <span className="shrink-0 text-[11px] text-grid-muted">{timeAgo(n.updatedAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <FieldDescription>{t("presentations.fromBrain.notesSelected", { count: selected.length })}</FieldDescription>
    </Field>
  )
}

function EntityField({ namespace, value, onChange }: { namespace: string; value: Entity | null; onChange: (e: Entity | null) => void }) {
  const { t } = useTranslations()
  const [query, setQuery] = useState("")
  return (
    <Field>
      <FieldLabel htmlFor="fb-entity">{t("presentations.fromBrain.entity")}</FieldLabel>
      {value ? (
        <div className="flex items-center gap-2 border border-line bg-grid-card px-3 py-2 text-sm">
          <NetworkIcon className="size-4 text-grid-muted" aria-hidden />
          <bdi className="min-w-0 flex-1 truncate">{value.name}</bdi>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t("presentations.fromBrain.change")}
          </Button>
        </div>
      ) : (
        <>
          <Input id="fb-entity" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("presentations.fromBrain.entitySearch")} />
          {query.trim() ? (
            <div className="border border-line">
              <EntityResults namespace={namespace} query={query} onPick={(e) => onChange(e)} />
            </div>
          ) : null}
        </>
      )}
    </Field>
  )
}
