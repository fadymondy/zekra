"use client"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { CheckIcon, PencilIcon, SearchIcon, StarIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SectionHeader } from "@/components/page"
import { Ltr } from "@/components/copy-field"
import { ErrorState, LoadingRows } from "@/components/states"
import { toastError } from "@/components/admin/toast-error"
import { brainApi, type Recalled } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useBrains } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

const NETWORKS = ["fact", "experience", "belief"]

/** A toggleable facet chip (aria-pressed). */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="grid-chip transition-colors hover:text-grid-fg aria-pressed:text-grid-fg">
      {active ? <CheckIcon className="size-3" /> : null}
      {children}
    </button>
  )
}

export default function AdminSearchPage() {
  const { t, formatNumber } = useTranslations()
  useDocumentTitle(t("nav.globalSearch"))
  const brains = useBrains()

  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set()) // empty = all brains
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<{ results?: Recalled[]; error?: unknown; q?: string }>({})

  const [fNet, setFNet] = useState<Set<string>>(new Set())
  const [fType, setFType] = useState<Set<string>>(new Set())
  const [fSrc, setFSrc] = useState<Set<string>>(new Set())
  const [highImp, setHighImp] = useState(false)

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setter(next)
  }
  const clearTuners = () => {
    setFNet(new Set())
    setFType(new Set())
    setFSrc(new Set())
    setHighImp(false)
  }

  async function run(e?: FormEvent) {
    e?.preventDefault()
    const query = q.trim()
    if (!query) return
    clearTuners()
    setPending(true)
    try {
      const r = await brainApi.search({ query, namespaces: selected.size ? [...selected] : undefined, limit: 30 })
      setState({ results: r.results ?? [], q: query })
    } catch (err) {
      setState({ error: err, q: query })
    } finally {
      setPending(false)
    }
  }

  const raw = useMemo(() => state.results ?? [], [state.results])
  const typeFacets = useMemo(() => [...new Set(raw.map((r) => r.memoryType).filter(Boolean))].sort(), [raw])
  const srcFacets = useMemo(() => [...new Set(raw.map((r) => r.sourceKind).filter(Boolean))].sort(), [raw])
  const netFacets = useMemo(() => NETWORKS.filter((n) => raw.some((r) => r.network === n)), [raw])
  const results = useMemo(
    () =>
      raw.filter(
        (r) =>
          (fNet.size === 0 || fNet.has(r.network)) &&
          (fType.size === 0 || fType.has(r.memoryType)) &&
          (fSrc.size === 0 || fSrc.has(r.sourceKind)) &&
          (!highImp || (r.importance ?? 0) >= 0.7),
      ),
    [raw, fNet, fType, fSrc, highImp],
  )
  const hasFilters = fNet.size > 0 || fType.size > 0 || fSrc.size > 0 || highImp

  const patch = (key: string, content: string) =>
    setState((s) => ({ ...s, results: s.results?.map((x) => (`${x.namespace}:${x.id}` === key ? { ...x, content } : x)) }))

  return (
    <>
      <SectionHeader micro={t("admin.micro")} title={t("admin.search.title")} description={t("admin.search.hint")} />

      <section className="border-t border-line px-6 py-6">
        <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("admin.search.placeholder")}
              aria-label={t("admin.search.title")}
              dir="auto"
              autoFocus
              className="h-10 ps-9"
            />
          </div>
          <Button type="submit" size="lg" className="h-10 px-5" disabled={pending || !q.trim()}>
            <SearchIcon />
            {pending ? t("admin.search.searching") : t("common.search")}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("admin.search.brains")}>
          <Chip active={selected.size === 0} onClick={() => setSelected(new Set())}>
            {t("admin.search.allBrains")}
          </Chip>
          {(brains.data ?? []).map((b) => (
            <Chip key={b.namespace} active={selected.has(b.namespace)} onClick={() => toggleIn(selected, setSelected, b.namespace)}>
              <Ltr>{b.namespace}</Ltr>
              <span className="text-grid-muted tabular-nums">{formatNumber(b.memories)}</span>
            </Chip>
          ))}
        </div>
      </section>

      {raw.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-6 py-3">
          <span className="grid-micro me-1">{t("admin.search.tune")}</span>
          {netFacets.map((n) => (
            <Chip key={n} active={fNet.has(n)} onClick={() => toggleIn(fNet, setFNet, n)}>
              {t(`admin.search.network.${n}`)}
            </Chip>
          ))}
          {typeFacets.map((ty) => (
            <Chip key={ty} active={fType.has(ty)} onClick={() => toggleIn(fType, setFType, ty)}>
              <Ltr>{ty}</Ltr>
            </Chip>
          ))}
          {srcFacets.map((s) => (
            <Chip key={s} active={fSrc.has(s)} onClick={() => toggleIn(fSrc, setFSrc, s)}>
              <Ltr>{s}</Ltr>
            </Chip>
          ))}
          <Chip active={highImp} onClick={() => setHighImp((v) => !v)}>
            <StarIcon className="size-3" />
            {t("admin.search.highImportance")}
          </Chip>
          {hasFilters ? (
            <Button variant="ghost" size="xs" className="ms-auto" onClick={clearTuners}>
              <XIcon />
              {t("admin.search.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <LoadingRows rows={4} />
      ) : state.error ? (
        <ErrorState error={state.error} />
      ) : state.q === undefined ? null : raw.length === 0 ? (
        <section className="border-y border-line">
          <div aria-hidden className="grid-hatch h-3 border-b border-line" />
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-grid-fg">{t("admin.search.noResults", { q: state.q })}</p>
            <p className="mt-1 text-sm text-grid-muted">{t("admin.search.noResultsBody")}</p>
          </div>
        </section>
      ) : results.length === 0 ? (
        <p className="border-y border-line px-6 py-8 text-center text-sm text-grid-muted">
          {t("admin.search.allFiltered", { n: formatNumber(raw.length) })}
        </p>
      ) : (
        <>
          <p className="border-t border-line px-6 pt-4 pb-3 text-xs text-grid-muted">
            {hasFilters
              ? t("admin.search.countFiltered", { n: formatNumber(results.length), total: formatNumber(raw.length) })
              : t("admin.search.count", { n: formatNumber(results.length) })}
          </p>
          <ul className="mb-8 divide-y divide-line border-y border-line">
            {results.map((r) => (
              <ResultRow key={`${r.namespace}:${r.id}`} r={r} onSaved={(c) => patch(`${r.namespace}:${r.id}`, c)} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** One hit with an inline edit (POST /api/brain/memory/edit, namespace from the hit). */
function ResultRow({ r, onSaved }: { r: Recalled; onSaved: (content: string) => void }) {
  const { t, locale, formatNumber } = useTranslations()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(r.content)
  const [saving, setSaving] = useState(false)
  const ns = r.namespace ?? ""
  const pct = Math.round(Math.max(0, Math.min(1, r.score)) * 100)

  async function save() {
    setSaving(true)
    try {
      await brainApi.editMemory({ namespace: ns, id: r.id, content: draft })
      onSaved(draft)
      setEditing(false)
    } catch (err) {
      toastError(err, locale)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="px-6 py-4 hover:bg-grid-soft">
      {editing ? (
        <div className="space-y-2">
          <Textarea dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(8, Math.max(3, draft.split("\n").length))} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDraft(r.content); setEditing(false) }}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !draft.trim() || draft === r.content}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <p dir="auto" className="flex-1 text-sm leading-relaxed whitespace-pre-wrap text-grid-fg">{r.content}</p>
            <Button variant="ghost" size="icon-sm" title={t("admin.search.edit")} aria-label={t("admin.search.edit")} onClick={() => { setDraft(r.content); setEditing(true) }}>
              <PencilIcon />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-grid-muted">
            {ns ? <span className="grid-chip"><Ltr>{ns}</Ltr></span> : null}
            <span className="grid-chip"><Ltr>{`${r.network}·${r.memoryType}`}</Ltr></span>
            <Ltr className="truncate">{r.sourceKind}{r.sourceRef ? ` · ${r.sourceRef}` : ""}</Ltr>
            {r.viaEntity ? <span>{t("admin.search.via")} <Ltr>{r.viaEntity}</Ltr></span> : null}
            <span className="ms-auto flex items-center gap-3">
              <span className="inline-flex items-center gap-2" title={t("admin.search.score")}>
                <span aria-hidden className="block h-1 w-12 bg-grid-soft">
                  <span className="block h-full bg-grid-action" style={{ width: `${pct}%` }} />
                </span>
                <Ltr className="tabular-nums">{formatNumber(r.score, { maximumFractionDigits: 3, minimumFractionDigits: 3 })}</Ltr>
              </span>
              <span>{t("admin.search.importance", { n: formatNumber(r.importance ?? 0, { maximumFractionDigits: 2 }) })}</span>
            </span>
          </div>
        </>
      )}
    </li>
  )
}
