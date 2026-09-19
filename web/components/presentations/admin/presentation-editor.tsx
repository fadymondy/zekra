"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BracesIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  DownloadIcon,
  FileTextIcon,
  LanguagesIcon,
  LoaderCircleIcon,
  PlayIcon,
  Redo2Icon,
  Share2Icon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"
import { cn } from "cn"

import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { ApiError, deletePresentation, getCatalog, getPresentation, listPresentations, translatePresentation, updatePresentation, validateContent } from "@/lib/presentations/api"
import { blankLike, convertType, errorsUnder, getIn, historyOf, insertAt, pathKey, record, redo, removeAt, setIn, undo, type History, type Path } from "@/lib/presentations/edit-path"
import { presentationsHref } from "@/lib/presentations/href"
import { ITEM_TEMPLATES, localized, move, newReportSection } from "@/lib/presentations/templates"
import { STATUSES, STYLE_KEYS, type Catalog, type DeckContent, type Detail, type FieldError, type PageContent, type PLocale, type ReportContent, type Slide, type Status, type Summary } from "@/lib/presentations/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { DeckViewer } from "../deck-viewer"
import { EditProvider, type EditApi } from "../edit"
import { PagePreview } from "../page-preview"
import { PresTheme } from "../pres-theme"
import { ReportView } from "../report-view"
import { SlideView } from "../slide"
import { AddButton, Boundary, Gallery, Rail, SlideThumb, type RailItem } from "./editor/parts"
import { fieldLabel, ObjectFields, variantOf, variantTypes, type FormCtx, type Schema } from "./editor/schema-form"
import { SharePanel } from "./editor/share-panel"
import { KIND_ICONS } from "./presentations-list"

/*
One document's editor, built like a slides app: a rail (slide thumbnails, or a report /
page outline) with add, duplicate, delete and drag-reorder; a canvas that is the real
rendered document, edited in place (see ../edit.tsx); and a properties panel whose forms
come from the API's JSON Schema (./editor/schema-form.tsx). JSON is still there, behind an
"Advanced" button.

Changes save themselves: after a pause the content is validated by the API and, when valid,
saved with PATCH (one locale at a time). Validation errors are shown on the field, the item
and the rail entry they belong to, never as a list of paths. Undo / redo (Ctrl+Z,
Ctrl+Shift+Z) run over the content.
*/

type Obj = Record<string, unknown>
type T = (key: string, vars?: Record<string, string | number>) => string
type Meta = { name: string; company: string; email: string; status: Status; style: string }
type SaveState = "saved" | "dirty" | "saving" | "invalid" | "error"

const metaOf = (d: Detail): Meta => ({ name: d.customer.name, company: d.customer.company, email: d.customer.email ?? "", status: d.status, style: d.style })
const clone = <V,>(v: V): V => JSON.parse(JSON.stringify(v)) as V

function summaryOf(item: Obj): string {
  for (const k of ["title", "heading", "quote", "text", "screen_title", "code"]) if (typeof item?.[k] === "string" && item[k]) return String(item[k]).slice(0, 80)
  return ""
}

/** The item a content path belongs to: a slide, a page section, a report section or one of its blocks. */
function itemPathOf(kind: Detail["kind"], path: Path): Path {
  if (kind === "deck") return path[0] === "slides" && typeof path[1] === "number" ? path.slice(0, 2) : []
  if (path[0] !== "sections" || typeof path[1] !== "number") return []
  if (kind === "report" && path[2] === "blocks" && typeof path[3] === "number") return path.slice(0, 4)
  return path.slice(0, 2)
}

export function PresentationEditor({ id, locale, namespace }: { id: string; locale: string; namespace: string }) {
  const { t } = useTranslations()
  const [doc, setDoc] = useState<Detail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lang, setLang] = useState<PLocale>("en")
  const [hist, setHist] = useState<History<Obj> | null>(null)
  const [meta, setMeta] = useState<Meta>({ name: "", company: "", email: "", status: "draft", style: "" })
  const [errors, setErrors] = useState<FieldError[]>([])
  const [saveState, setSaveState] = useState<SaveState>("saved")
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<Path>([])
  const [active, setActive] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [gallery, setGallery] = useState<null | "item" | "block">(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [pages, setPages] = useState<Summary[]>([])
  const [embeds, setEmbeds] = useState<Record<string, { style: string; content: PageContent }>>({})
  const draft = hist?.present ?? null
  useDocumentTitle(doc ? `${String(draft?.title ?? doc.title)} · ${t("presentations.title")}` : t("presentations.title"))

  // What the server has, to know whether there is anything to save.
  const saved = useRef<{ draft: Obj | null; meta: string }>({ draft: null, meta: "" })
  const live = useRef({ draft, meta, lang, doc })
  live.current = { draft, meta, lang, doc }
  const panel = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)

  const adopt = useCallback((d: Detail, keepLang?: PLocale) => {
    const l = keepLang && d.content[keepLang] ? keepLang : d.locale
    const content = clone((d.content[l] ?? {}) as Obj)
    const m = metaOf(d)
    saved.current = { draft: content, meta: JSON.stringify(m) }
    setDoc(d)
    setLang(l)
    setHist(historyOf(content))
    setMeta(m)
    setErrors([])
    setSaveState("saved")
  }, [])

  useEffect(() => {
    getPresentation(id)
      .then((d) => {
        adopt(d)
        setSel(d.kind === "deck" ? ["slides", 0] : [])
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
    listPresentations({ namespace, kind: "page" })
      .then(setPages)
      .catch(() => setPages([]))
    getCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null))
  }, [id, namespace, adopt])

  // ---- content changes, undo, redo -------------------------------------------
  const apply = useCallback((fn: (d: Obj) => Obj, key = "") => {
    setHist((h) => (h ? record(h, fn(h.present), key) : h))
    setMessage(null)
  }, [])
  const setAt = useCallback((path: Path, value: unknown) => apply((d) => setIn(d, path, value), `set:${pathKey(path)}`), [apply])
  const doUndo = useCallback(() => setHist((h) => (h ? undo(h) : h)), [])
  const doRedo = useCallback(() => setHist((h) => (h ? redo(h) : h)), [])

  // ---- saving ------------------------------------------------------------------
  const flush = useCallback(async (): Promise<boolean> => {
    const { draft: d, meta: m, lang: l, doc: cur } = live.current
    if (!cur || !d) return true
    const metaKey = JSON.stringify(m)
    if (saved.current.draft === d && saved.current.meta === metaKey) return true
    try {
      if (saved.current.draft !== d) {
        const v = await validateContent(cur.kind, d)
        if (live.current.draft !== d) return false // edited meanwhile; the next pass takes it
        setErrors(v.errors ?? [])
        if (v.errors?.length) {
          setSaveState("invalid")
          return false
        }
      }
      setSaveState("saving")
      const out = await updatePresentation(cur.id, {
        locale: l,
        content: d,
        status: m.status,
        style: cur.kind === "page" ? m.style : undefined,
        customer: { name: m.name, company: m.company, email: m.email },
      })
      saved.current = { draft: d, meta: metaKey }
      setDoc(out)
      setSaveState(live.current.draft === d && JSON.stringify(live.current.meta) === metaKey ? "saved" : "dirty")
      return true
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) {
        setErrors(err.errors)
        setSaveState("invalid")
      } else {
        setSaveState("error")
        setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) })
      }
      return false
    }
  }, [])

  const metaKey = JSON.stringify(meta)
  useEffect(() => {
    if (!draft || (saved.current.draft === draft && saved.current.meta === metaKey)) return
    setSaveState((s) => (s === "saving" ? s : "dirty"))
    const handle = setTimeout(() => void flush(), 900)
    return () => clearTimeout(handle)
  }, [draft, metaKey, flush])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const { draft: d, meta: m } = live.current
      if (saved.current.draft !== d || saved.current.meta !== JSON.stringify(m)) e.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  // Ctrl/⌘+Z, Ctrl/⌘+Shift+Z (and Ctrl+Y), Ctrl/⌘+S — over the content, wherever the caret is,
  // except in fields that are not content (link label, customer, icon search).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === "s") {
        e.preventDefault()
        void flush()
        return
      }
      if (k !== "z" && k !== "y") return
      const target = e.target as HTMLElement | null
      if (target?.closest("[data-native-undo], [role=dialog], [data-slot=popover-content]")) return
      e.preventDefault()
      if (k === "y" || e.shiftKey) doRedo()
      else doUndo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [doRedo, doUndo, flush])

  // ---- embeds for the deck ----------------------------------------------------
  const embedIds = useMemo(() => {
    if (doc?.kind !== "deck" || !draft) return []
    return ((draft.slides as Obj[] | undefined) ?? []).filter((s) => s?.type === "embed" && s.document_id).map((s) => String(s.document_id))
  }, [doc, draft])
  useEffect(() => {
    for (const eid of embedIds) {
      if (embeds[eid]) continue
      getPresentation(eid)
        .then((p) => {
          const c = (p.content[lang] ?? p.content[p.locale]) as unknown as PageContent | undefined
          if (c) setEmbeds((m) => ({ ...m, [eid]: { style: p.style, content: c } }))
        })
        .catch(() => undefined)
    }
  }, [embedIds, embeds, lang])

  // ---- in-place editing ---------------------------------------------------------
  const invalid = useMemo(() => {
    const m = new Map<string, { message: string; hint?: string }>()
    for (const e of errorsUnder(errors, [])) m.set(pathKey(e.path), { message: e.message, hint: e.hint })
    return m
  }, [errors])
  const kind = doc?.kind
  const editApi = useMemo<EditApi>(
    () => ({
      set: (path, value) => setAt(path, value),
      listKey: (listPath, index, key) => {
        const list = (getIn(live.current.draft, listPath) as unknown[] | undefined) ?? []
        if (key === "enter") {
          let blank = blankLike(list[index])
          if (blank && typeof blank === "object" && !Array.isArray(blank)) blank = Object.fromEntries(Object.entries(blank as Obj).filter(([k]) => ["text", "title", "label", "value"].includes(k)))
          apply((d) => insertAt(d, listPath, index + 1, blank))
          pendingFocus.current = pathKey([...listPath, index + 1])
        } else if (list.length > 1) {
          apply((d) => removeAt(d, listPath, index))
          pendingFocus.current = pathKey([...listPath, Math.max(0, index - 1)])
        }
      },
      focus: (path) => {
        setActive(pathKey(path))
        if (kind && kind !== "deck") setSel(itemPathOf(kind, path))
      },
      invalid: new Map([...invalid].map(([k, v]) => [k, v.hint ? `${v.message} — ${v.hint}` : v.message])),
    }),
    [setAt, apply, invalid, kind],
  )

  // After Enter / Backspace in a list: the caret goes to the new (or previous) item.
  useEffect(() => {
    const want = pendingFocus.current
    if (!want) return
    pendingFocus.current = null
    const el = canvas.current?.querySelector<HTMLElement>(["", ".text", ".title"].map((s) => `[data-edit-path="${want}${s}"]`).join(","))
    if (!el) return
    el.focus()
    const range = window.getSelection()
    range?.selectAllChildren(el)
    range?.collapseToEnd()
  }, [draft])

  // The properties panel follows the caret.
  useEffect(() => {
    if (!active) return
    panel.current?.querySelector(`[data-field-path="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [active])

  // ---- language, translation, status, delete --------------------------------------
  const switchLang = async (l: PLocale) => {
    if (!doc || l === lang) return
    if (!doc.content[l]) return void translate(l)
    if (!(await flush()) && !window.confirm(t("presentations.discard"))) return
    const fresh = live.current.doc ?? doc
    const content = clone((fresh.content[l] ?? {}) as Obj)
    saved.current = { ...saved.current, draft: content }
    setLang(l)
    setHist(historyOf(content))
    setErrors([])
    setActive("")
    setSaveState("saved")
  }

  /** Fills `to` from the other language. */
  const translate = async (to: PLocale) => {
    if (!doc) return
    const from: PLocale = to === "en" ? "ar" : "en"
    if (doc.content[to] && !window.confirm(t("presentations.editor.confirmTranslate", { to: t(`presentations.locale.${to}`), from: t(`presentations.locale.${from}`) }))) return
    setBusy(true)
    setMessage(null)
    try {
      if (lang === from && !(await flush())) throw new Error(t("presentations.editor.fixFirst"))
      adopt(await translatePresentation(doc.id, to), to)
      setMessage({ tone: "ok", text: t("presentations.translated") })
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError && err.status === 503 ? t("presentations.noTranslator") : err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const setStatus = (s: Status) => {
    if (s === "archived" && !window.confirm(t("presentations.editor.confirmArchive"))) return
    setMeta((m) => ({ ...m, status: s }))
  }

  const remove = async () => {
    if (!doc || !window.confirm(t("presentations.confirmDelete"))) return
    await deletePresentation(doc.id)
    saved.current = { draft: live.current.draft, meta: JSON.stringify(live.current.meta) }
    window.location.href = presentationsHref(locale, namespace)
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{t("presentations.loadFailed")}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!doc || !draft || !hist) {
    return (
      <div className="grid gap-4 p-6 lg:grid-cols-[13rem_1fr_22rem]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const Icon = KIND_ICONS[doc.kind]
  const Back = locale === "ar" ? ArrowRightIcon : ArrowLeftIcon
  const dir = lang === "ar" ? "rtl" : "ltr"
  const other: PLocale = lang === "en" ? "ar" : "en"
  const schemas = (catalog?.schemas ?? {}) as Record<string, Schema>
  const docSchema = schemas[doc.kind]

  // ---- the rail ------------------------------------------------------------------
  const hasError = (p: Path) => errorsUnder(errors, p).length > 0
  const slides = (Array.isArray(draft.slides) ? draft.slides : []) as Obj[]
  const sections = (Array.isArray(draft.sections) ? draft.sections : []) as Obj[]
  const rail: RailItem[] = []
  if (doc.kind === "deck") {
    slides.forEach((s, i) =>
      rail.push({
        key: pathKey(["slides", i]),
        path: ["slides", i],
        listPath: ["slides"],
        index: i,
        label: summaryOf(s) || t(`presentations.type.${String(s?.type)}`),
        type: String(s?.type),
        invalid: hasError(["slides", i]),
        thumb: <SlideThumb slide={s as unknown as Slide} dir={dir} embeds={embeds} />,
      }),
    )
  } else {
    sections.forEach((s, i) => {
      rail.push({ key: pathKey(["sections", i]), path: ["sections", i], listPath: ["sections"], index: i, label: summaryOf(s) || (doc.kind === "page" ? "" : t("presentations.sectionHeading")), type: doc.kind === "page" ? String(s?.type) : undefined, invalid: hasError(["sections", i]) })
      if (doc.kind === "report")
        ((Array.isArray(s?.blocks) ? s.blocks : []) as Obj[]).forEach((b, j) =>
          rail.push({ key: pathKey(["sections", i, "blocks", j]), path: ["sections", i, "blocks", j], listPath: ["sections", i, "blocks"], index: j, depth: 1, label: summaryOf(b), type: String(b?.type), invalid: hasError(["sections", i, "blocks", j]) }),
        )
    })
  }

  const select = (p: Path, scroll = true) => {
    setSel(p)
    setActive("")
    setAdvanced(false)
    if (scroll && doc.kind !== "deck" && p.length) {
      const q = p.length === 4 ? `[data-block="${p[1]}.${p[3]}"]` : `[data-section="${p[1]}"]`
      requestAnimationFrame(() => canvas.current?.querySelector(q)?.scrollIntoView({ block: "start", behavior: "smooth" }))
    }
  }
  const listOf = (p: Path) => (getIn(draft, p) as unknown[] | undefined) ?? []
  const moveItem = (it: RailItem, to: number) => {
    const list = listOf(it.listPath)
    if (to < 0 || to >= list.length) return
    apply((d) => setIn(d, it.listPath, move(listOf(it.listPath), it.index, to)))
    select([...it.listPath, to], false)
  }
  const duplicateItem = (it: RailItem) => {
    apply((d) => insertAt(d, it.listPath, it.index + 1, clone(getIn(d, it.path))))
    select([...it.listPath, it.index + 1])
  }
  const removeItem = (it: RailItem) => {
    const n = listOf(it.listPath).length
    if (n <= 1) return setMessage({ tone: "error", text: t("presentations.editor.keepOne") })
    apply((d) => removeAt(d, it.listPath, it.index))
    select([...it.listPath, Math.min(it.index, n - 2)], false)
  }

  /** Adds from the gallery, after the selected item of the same list. */
  const addItem = (item: Obj, as: "item" | "block") => {
    let listPath: Path
    if (doc.kind === "deck") listPath = ["slides"]
    else if (doc.kind === "page" || as === "item") listPath = ["sections"]
    else listPath = ["sections", typeof sel[1] === "number" ? sel[1] : Math.max(0, sections.length - 1), "blocks"]
    if (doc.kind === "deck" && item.type === "embed") item.document_id = pages.find((p) => p.id !== doc.id)?.id ?? ""
    const selIndex = sel.length === listPath.length + 1 && pathKey(sel.slice(0, -1)) === pathKey(listPath) ? Number(sel[sel.length - 1]) : listOf(listPath).length - 1
    apply((d) => insertAt(d, listPath, selIndex + 1, item))
    select([...listPath, selIndex + 1])
  }

  // ---- the selected item --------------------------------------------------------
  const selected = sel.length ? (getIn(draft, sel) as Obj | undefined) : draft
  const selKey = pathKey(sel)
  const listSchema: Schema | undefined =
    doc.kind === "deck" ? docSchema?.properties?.slides?.items : sel.length === 4 ? docSchema?.properties?.sections?.items?.properties?.blocks?.items : docSchema?.properties?.sections?.items
  const isReportSection = doc.kind === "report" && sel.length === 2
  const itemSchema = !sel.length ? docSchema : isReportSection ? listSchema : variantOf(listSchema, selected?.type)
  const templateKind: Detail["kind"] = doc.kind
  const types = sel.length && !isReportSection ? (variantTypes(listSchema).length ? variantTypes(listSchema) : Object.keys(ITEM_TEMPLATES[templateKind])) : []

  const changeType = (type: string) => {
    if (!selected || selected.type === type) return
    const tpl = localized(ITEM_TEMPLATES[templateKind][type] ?? { type }, lang)
    if (type === "embed") tpl.document_id = pages.find((p) => p.id !== doc.id)?.id ?? ""
    const allowed = Object.keys(variantOf(listSchema, type)?.properties ?? {})
    apply((d) => setIn(d, sel, convertType(selected, tpl, allowed.length ? allowed : undefined)))
  }

  const formCtx: FormCtx = {
    t,
    dir,
    root: selected,
    base: sel,
    errors: new Map([...invalid].filter(([k]) => !selKey || k === selKey || k.startsWith(selKey + "."))),
    active,
    set: setAt,
    scenes: catalog?.scenes ?? [],
    pages: pages.filter((p) => p.id !== doc.id).map((p) => ({ id: p.id, title: p.title })),
  }
  const itemErrors = errorsUnder(errors, sel)
  const embedBlocked = pages.filter((p) => p.id !== doc.id).length === 0 ? { embed: t("presentations.embedNone") } : undefined

  // ---- the canvas -----------------------------------------------------------------
  const slideIndex = doc.kind === "deck" && typeof sel[1] === "number" ? Math.min(sel[1], slides.length - 1) : 0
  const slide = slides[slideIndex] as unknown as Slide | undefined
  let stage: ReactNode
  if (doc.kind === "deck") {
    stage = slide ? (
      <div className="pres-deck-stage flex w-full items-center justify-center p-3 max-lg:aspect-video sm:p-6 lg:min-h-0 lg:flex-1">
        <EditProvider api={editApi} prefix={["slides", slideIndex]}>
          <section
            key={slideIndex}
            dir={dir}
            lang={lang}
            data-testid="canvas-slide"
            data-slide-type={slide.type}
            className={cn("pres-root pres-slide aspect-video max-h-full w-full max-w-[min(100%,calc(100cqh*16/9))] overflow-hidden rounded-xl border bg-card p-[4%] shadow-sm", hasError(["slides", slideIndex]) && "ring-2 ring-destructive/60")}
          >
            <SlideView slide={slide} embeds={embeds} dir={dir} embedHref={(docId) => presentationsHref(lang, namespace, docId)} labels={{ missingEmbed: t("presentations.deck.missingEmbed"), openPage: t("presentations.deck.openPage") }} />
          </section>
        </EditProvider>
      </div>
    ) : (
      <p className="p-6 text-sm text-muted-foreground">{t("presentations.previewEmpty")}</p>
    )
  } else {
    stage = (
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="canvas-doc" lang={lang}>
        <EditProvider api={editApi} prefix={[]}>
          {doc.kind === "report" ? (
            Array.isArray(draft.sections) ? (
              <ReportView content={draft as unknown as ReportContent} locale={lang} dir={dir} labels={{ summary: t("presentations.export.summary"), contents: t("presentations.report.contents") }} />
            ) : null
          ) : Array.isArray(draft.sections) ? (
            <PagePreview content={draft as unknown as PageContent} style={meta.style} dir={dir} still />
          ) : null}
        </EditProvider>
      </div>
    )
  }

  const SaveIcon = saveState === "saving" ? LoaderCircleIcon : saveState === "saved" ? CheckCircle2Icon : saveState === "dirty" ? CircleDotIcon : AlertCircleIcon
  const addLabel = t(`presentations.editor.add.${doc.kind}`)

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]" data-testid="presentation-editor">
      {/* ---- top bar ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={presentationsHref(locale, namespace)} aria-label={t("presentations.back")} />}>
            <Back />
          </Button>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="max-w-[28ch] truncate text-sm font-semibold sm:max-w-[48ch]" dir="auto">
            {String(draft.title ?? doc.title)}
          </h2>
          <Badge variant="outline">{t(`presentations.kind.${doc.kind}`)}</Badge>
          <button
            type="button"
            onClick={() => void flush()}
            data-testid="save-state"
            data-state={saveState}
            aria-live="polite"
            title={t("presentations.editor.saveNow")}
            className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs", saveState === "invalid" || saveState === "error" ? "text-destructive" : "text-muted-foreground")}
          >
            <SaveIcon className={cn("size-3.5", saveState === "saving" && "animate-spin")} aria-hidden />
            {saveState === "invalid" ? t("presentations.editor.state.invalid", { count: errors.length }) : t(`presentations.editor.state.${saveState}`)}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" onClick={doUndo} disabled={!hist.past.length} aria-label={t("presentations.editor.undo")} title={`${t("presentations.editor.undo")} (Ctrl+Z)`}>
            <Undo2Icon className="rtl:-scale-x-100" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={doRedo} disabled={!hist.future.length} aria-label={t("presentations.editor.redo")} title={`${t("presentations.editor.redo")} (Ctrl+Shift+Z)`}>
            <Redo2Icon className="rtl:-scale-x-100" />
          </Button>
          <div className="flex rounded-lg border p-0.5" role="group" aria-label={t("presentations.language")}>
            {(["en", "ar"] as PLocale[]).map((l) => (
              <Button key={l} size="xs" variant={l === lang ? "secondary" : "ghost"} onClick={() => void switchLang(l)} disabled={busy} aria-pressed={l === lang} data-testid={`lang-${l}`} title={doc.content[l] ? t(`presentations.locale.${l}`) : t("presentations.editor.createLocale", { lang: t(`presentations.locale.${l}`) })}>
                {l.toUpperCase()}
                {!doc.content[l] ? <span className="text-muted-foreground">+</span> : null}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void translate(lang)} disabled={busy || !doc.content[other]} data-testid="translate">
            <LanguagesIcon />
            <span className="max-xl:sr-only">{t("presentations.editor.translateFrom", { lang: t(`presentations.locale.${other}`) })}</span>
          </Button>
          <Select value={meta.status} onValueChange={(v) => setStatus((v as Status) ?? "draft")}>
            <SelectTrigger size="sm" className="w-28" aria-label={t("presentations.col.status")} data-testid="status">
              <SelectValue>{(v) => t(`presentations.status.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`presentations.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {meta.status === "draft" ? (
            <Button size="sm" onClick={() => setStatus("ready")} disabled={errors.length > 0} data-testid="mark-ready">
              <CheckCircle2Icon />
              {t("presentations.editor.markReady")}
            </Button>
          ) : null}
          {doc.kind === "deck" ? (
            <Button variant="outline" size="sm" onClick={() => setPresenting(true)} data-testid="present">
              <PlayIcon className="rtl:-scale-x-100" />
              <span className="max-xl:sr-only">{t("presentations.preview")}</span>
            </Button>
          ) : null}
          {(doc.formats ?? []).map((f) => (
            <Button key={f} variant="outline" size="sm" nativeButton={false} render={<a href={`${presentationsHref(lang, namespace, doc.id)}/export/${f}`} download />}>
              <DownloadIcon />
              {t(`presentations.format.${f}`)}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} data-testid="open-share">
            <Share2Icon />
            {t("presentations.tab.share")}
            {doc.active_shares ? <Badge variant="secondary">{doc.active_shares}</Badge> : null}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={t("presentations.delete")}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {message ? (
        <div aria-live="polite" className="border-b px-3 py-2">
          <Alert variant={message.tone === "error" ? "destructive" : "default"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[13.5rem_minmax(0,1fr)_22rem]">
        {/* ---- rail ---- */}
        <aside className="flex min-h-0 flex-col border-b lg:border-e lg:border-b-0" aria-label={t(`presentations.items.${doc.kind}`)}>
          <div className="p-2 pb-0">
            <Button variant={sel.length === 0 ? "secondary" : "ghost"} size="sm" className="w-full justify-start" onClick={() => select([])} data-testid="select-document">
              <FileTextIcon />
              {t("presentations.editor.document")}
              {errorsUnder(errors, []).some((e) => e.path.length <= 1) ? <span className="ms-auto size-1.5 rounded-full bg-destructive" /> : null}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto max-lg:max-h-56">
            <Rail items={rail} selected={selKey} t={t} onSelect={(it) => select(it.path)} onMove={moveItem} onDuplicate={duplicateItem} onRemove={removeItem} />
          </div>
          <div className="grid gap-1.5 border-t p-2">
            <AddButton label={addLabel} onClick={() => (doc.kind === "report" ? apply((d) => insertAt(d, ["sections"], sections.length, localized(newReportSection(), lang))) : setGallery("item"))} testid="add-item" />
            {doc.kind === "report" ? <AddButton label={t("presentations.editor.add.block")} onClick={() => setGallery("block")} testid="add-block" /> : null}
          </div>
        </aside>

        {/* ---- canvas ---- */}
        <main
          ref={canvas}
          className="flex min-h-0 min-w-0 flex-col bg-muted/30"
          aria-label={t("presentations.editor.canvas")}
          // The canvas is for editing: a link or button inside the document must not act.
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest("a[href]")) e.preventDefault()
          }}
        >
          <PresTheme className="flex min-h-0 flex-1 flex-col bg-transparent">
            <Boundary resetKey={draft} fallback={<p className="p-6 text-sm text-destructive">{t("presentations.previewBroken")}</p>}>
              {stage}
            </Boundary>
          </PresTheme>
          {itemErrors.length ? (
            <ul className="grid gap-1 border-t bg-destructive/5 px-3 py-2 text-xs" data-testid="item-errors" role="alert">
              {itemErrors.slice(0, 6).map((e, i) => (
                <li key={i}>
                  <button type="button" className="flex flex-wrap items-baseline gap-x-2 text-start text-destructive hover:underline" onClick={() => setActive(pathKey([...sel, ...e.path]))}>
                    <AlertCircleIcon className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
                    <span className="font-medium">{e.path.map((k) => (typeof k === "number" ? String(k + 1) : fieldLabel(t, k))).join(" › ") || "—"}</span>
                    <span>{e.message}</span>
                    {e.hint ? <span className="text-destructive/80">— {e.hint}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {doc.kind === "deck" && slide ? (
            <div className="border-t bg-background p-2">
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                {t("presentations.deck.notes")}
                <Textarea dir={dir} rows={2} className="min-h-12 resize-y text-sm text-foreground" value={String((slide as Obj).notes ?? "")} placeholder={t("presentations.editor.notesHelp")} onChange={(e) => setAt(["slides", slideIndex, "notes"], e.target.value || undefined)} />
              </label>
            </div>
          ) : null}
        </main>

        {/* ---- properties ---- */}
        <aside ref={panel} className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-t p-3 lg:border-s lg:border-t-0" aria-label={t("presentations.editor.properties")} data-testid="properties">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{sel.length === 0 ? t("presentations.editor.document") : isReportSection ? t("presentations.sectionHeading") : t("presentations.editor.properties")}</h3>
            <Button variant={advanced ? "secondary" : "ghost"} size="xs" onClick={() => setAdvanced((v) => !v)} aria-pressed={advanced} data-testid="advanced">
              <BracesIcon />
              {t("presentations.editor.advanced")}
            </Button>
          </div>
          {!selected ? (
            <p className="text-sm text-muted-foreground">{t("presentations.editor.nothingSelected")}</p>
          ) : advanced ? (
            <JsonEditor key={selKey} t={t} value={selected} onChange={(v) => apply((d) => (sel.length ? setIn(d, sel, v) : v))} />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4">
              {types.length ? (
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  {t(`presentations.editor.typeOf.${doc.kind === "deck" ? "slide" : sel.length === 4 ? "block" : "section"}`)}
                  <Select value={String(selected.type ?? "")} onValueChange={(v) => changeType(String(v))}>
                    <SelectTrigger className="w-full" data-testid="item-type">
                      <SelectValue>{(v) => t(`presentations.type.${String(v)}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {types.map((ty) => (
                        <SelectItem key={ty} value={ty} disabled={ty === "embed" && !!embedBlocked}>
                          {t(`presentations.type.${ty}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="font-normal">{t("presentations.editor.typeHelp")}</span>
                </label>
              ) : null}
              {catalog ? (
                <ObjectFields ctx={formCtx} schema={itemSchema} value={selected} rel={[]} skip={sel.length === 0 ? ["slides", "sections"] : isReportSection ? ["blocks"] : ["notes"]} />
              ) : (
                <Skeleton className="h-40" />
              )}
              {sel.length === 0 ? (
                <div className="grid gap-3 border-t pt-3" data-native-undo>
                  <p className="text-xs font-semibold">{t("presentations.details")}</p>
                  {(
                    [
                      ["company", t("presentations.customer.company")],
                      ["name", t("presentations.customer.name")],
                      ["email", t("presentations.customer.email")],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="grid gap-1 text-xs font-medium text-muted-foreground">
                      {label}
                      <Input className="h-8 text-foreground" dir={k === "email" ? "ltr" : "auto"} type={k === "email" ? "email" : "text"} value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
                    </label>
                  ))}
                  {doc.kind === "page" ? (
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                      {t("presentations.style")}
                      <Select value={meta.style} onValueChange={(v) => setMeta((m) => ({ ...m, style: String(v ?? "minimal") }))}>
                        <SelectTrigger className="w-full">
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
                    </label>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{t("presentations.statusHelp")}</p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      <Gallery
        open={gallery !== null}
        onOpenChange={(v) => !v && setGallery(null)}
        kind={doc.kind}
        title={gallery === "block" ? t("presentations.editor.add.block") : addLabel}
        locale={lang}
        dir={dir}
        t={t}
        disabled={doc.kind === "deck" ? embedBlocked : undefined}
        onPick={(item) => addItem(item, gallery ?? "item")}
      />

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" data-native-undo>
          <DialogHeader>
            <DialogTitle>{t("presentations.tab.share")}</DialogTitle>
            <DialogDescription className="sr-only">{t("presentations.share.help")}</DialogDescription>
          </DialogHeader>
          {shareOpen ? <SharePanel t={t} doc={doc} locale={locale} lang={lang} namespace={namespace} onChanged={() => getPresentation(doc.id).then((d) => setDoc(d))} /> : null}
        </DialogContent>
      </Dialog>

      {doc.kind === "deck" ? (
        <Dialog open={presenting} onOpenChange={setPresenting}>
          <DialogContent className="sm:max-w-5xl" data-testid="live-preview">
            <DialogHeader>
              <DialogTitle>{t("presentations.preview")}</DialogTitle>
              <DialogDescription>{t("presentations.editor.previewHelp")}</DialogDescription>
            </DialogHeader>
            {presenting && slides.length ? (
              <PresTheme className="overflow-hidden rounded-xl border">
                <DeckViewer content={draft as unknown as DeckContent} embeds={embeds} dir={dir} showNotes fill={false} embedHref={(docId) => presentationsHref(lang, namespace, docId)} />
              </PresTheme>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

function JsonEditor({ t, value, onChange }: { t: T; value: Obj; onChange: (v: Obj) => void }) {
  const serialized = useMemo(() => JSON.stringify(value, null, 2), [value])
  const [text, setText] = useState(serialized)
  const [bad, setBad] = useState<string | null>(null)
  const last = useRef(serialized)
  useEffect(() => {
    if (serialized !== last.current) {
      last.current = serialized
      setText(serialized)
      setBad(null)
    }
  }, [serialized])
  return (
    <div className="space-y-2" data-testid="json-editor" data-native-undo>
      <p className="text-xs text-muted-foreground">{t("presentations.editor.advancedHelp")}</p>
      <Textarea
        dir="ltr"
        spellCheck={false}
        rows={24}
        className="font-mono text-xs"
        value={text}
        aria-label={t("presentations.tab.json")}
        onChange={(e) => {
          setText(e.target.value)
          try {
            const parsed = JSON.parse(e.target.value) as unknown
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("presentations.jsonObject"))
            setBad(null)
            last.current = JSON.stringify(parsed, null, 2)
            onChange(parsed as Obj)
          } catch (err) {
            setBad(err instanceof Error ? err.message : String(err))
          }
        }}
      />
      {bad ? <p className="text-xs text-destructive">{t("presentations.jsonInvalid", { reason: bad })}</p> : null}
    </div>
  )
}
