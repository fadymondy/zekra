"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  LanguagesIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"

import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import {
  ApiError,
  createShare,
  deletePresentation,
  getPresentation,
  listPresentations,
  revokeShare,
  translatePresentation,
  updatePresentation,
  validateContent,
  type ShareCreated,
} from "@/lib/presentations/api"
import { presentationsHref } from "@/lib/presentations/href"
import { ITEM_TEMPLATES, ITEMS_KEY, move, newReportSection } from "@/lib/presentations/templates"
import {
  STATUSES,
  STYLE_KEYS,
  type DeckContent,
  type Detail,
  type FieldError,
  type PageContent,
  type PLocale,
  type ReportContent,
  type Status,
  type Summary,
} from "@/lib/presentations/types"
import { CopyButton } from "./copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { DeckViewer } from "../deck-viewer"
import { PagePreview } from "../page-preview"
import { PresTheme } from "../pres-theme"
import { ReportView } from "../report-view"
import { KIND_ICONS } from "./presentations-list"

/*
One document's editor (FM-345): details, a structured outline (add from a
template, reorder, remove, edit one item's JSON), the whole content as JSON,
share links with copy and revoke, views, exports, and a live preview beside
it. The API validates every change; its errors are listed with their paths.
*/

type Obj = Record<string, unknown>
type T = (key: string, vars?: Record<string, string | number>) => string

const clone = <V,>(v: V): V => JSON.parse(JSON.stringify(v)) as V

export function PresentationEditor({ id, locale, namespace }: { id: string; locale: string; namespace: string }) {
  const { t } = useTranslations()
  const [doc, setDoc] = useState<Detail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lang, setLang] = useState<PLocale>("en")
  const [draft, setDraft] = useState<Obj | null>(null)
  const [meta, setMeta] = useState({ name: "", company: "", email: "", status: "draft" as Status, style: "" })
  const [errors, setErrors] = useState<FieldError[]>([])
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pages, setPages] = useState<Summary[]>([])
  const [embeds, setEmbeds] = useState<Record<string, { style: string; content: PageContent }>>({})
  useDocumentTitle(doc ? `${doc.title} · ${t("presentations.title")}` : t("presentations.title"))

  const adopt = useCallback((d: Detail, keepLang?: PLocale) => {
    setDoc(d)
    const l = keepLang && d.content[keepLang] ? keepLang : d.locale
    setLang(l)
    setDraft(clone((d.content[l] ?? {}) as Obj))
    setMeta({ name: d.customer.name, company: d.customer.company, email: d.customer.email ?? "", status: d.status, style: d.style })
    setDirty(false)
    setErrors([])
  }, [])

  useEffect(() => {
    getPresentation(id)
      .then((d) => adopt(d))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
    listPresentations({ namespace, kind: "page" })
      .then(setPages)
      .catch(() => setPages([]))
  }, [id, namespace, adopt])

  // Live validation, debounced.
  useEffect(() => {
    if (!doc || !draft || !dirty) return
    const handle = setTimeout(() => {
      validateContent(doc.kind, draft)
        .then((r) => setErrors(r.errors ?? []))
        .catch(() => undefined)
    }, 400)
    return () => clearTimeout(handle)
  }, [doc, draft, dirty])

  // Embedded page previews for the deck preview.
  const embedIds = useMemo(() => {
    if (doc?.kind !== "deck" || !draft) return []
    return ((draft.slides as Obj[] | undefined) ?? []).filter((s) => s.type === "embed" && s.document_id).map((s) => String(s.document_id))
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

  const change = (next: Obj) => {
    setDraft(next)
    setDirty(true)
    setMessage(null)
  }

  const save = async () => {
    if (!doc || !draft) return
    setBusy(true)
    setMessage(null)
    try {
      const d = await updatePresentation(doc.id, {
        locale: lang,
        content: draft,
        status: meta.status,
        style: doc.kind === "page" ? meta.style : undefined,
        customer: { name: meta.name, company: meta.company, email: meta.email },
      })
      adopt(d, lang)
      setMessage({ tone: "ok", text: t("presentations.saved") })
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.errors)
      setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const switchLang = (l: PLocale) => {
    if (!doc) return
    if (dirty && !window.confirm(t("presentations.discard"))) return
    setLang(l)
    setDraft(clone((doc.content[l] ?? {}) as Obj))
    setDirty(false)
    setErrors([])
  }

  const translate = async () => {
    if (!doc) return
    const to: PLocale = lang === "en" ? "ar" : "en"
    if (doc.content[to] && !window.confirm(t("presentations.replaceTranslation"))) return
    setBusy(true)
    setMessage(null)
    try {
      adopt(await translatePresentation(doc.id, to), to)
      setMessage({ tone: "ok", text: t("presentations.translated") })
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError && err.status === 503 ? t("presentations.noTranslator") : err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!doc || !window.confirm(t("presentations.confirmDelete"))) return
    await deletePresentation(doc.id)
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
  if (!doc || !draft) {
    return (
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const Icon = KIND_ICONS[doc.kind]
  const Back = locale === "ar" ? ArrowRightIcon : ArrowLeftIcon
  const dir = lang === "ar" ? "rtl" : "ltr"
  const other: PLocale = lang === "en" ? "ar" : "en"

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={presentationsHref(locale, namespace)} aria-label={t("presentations.back")} />}>
            <Back />
          </Button>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="truncate text-lg font-semibold">{String(draft.title ?? doc.title)}</h2>
          <Badge variant="outline">{t(`presentations.kind.${doc.kind}`)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label={t("presentations.language")}>
            {(["en", "ar"] as PLocale[]).map((l) => (
              <Button key={l} size="sm" variant={l === lang ? "secondary" : "ghost"} onClick={() => switchLang(l)} disabled={!doc.content[l]} aria-pressed={l === lang}>
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={translate} disabled={busy}>
            <LanguagesIcon />
            {t("presentations.translateTo", { lang: t(`presentations.locale.${other}`) })}
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !dirty && meta.status === doc.status && meta.style === doc.style && meta.name === doc.customer.name && meta.company === doc.customer.company && meta.email === (doc.customer.email ?? "")}>
            <SaveIcon />
            {t("presentations.save")}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={t("presentations.delete")}>
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div aria-live="polite">
        {message ? (
          <Alert variant={message.tone === "error" ? "destructive" : "default"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      {errors.length ? (
        <Alert variant="destructive" data-testid="validation-errors">
          <AlertTitle>{t("presentations.invalid", { count: errors.length })}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5 font-mono text-xs" dir="ltr">
              {errors.slice(0, 12).map((e, i) => (
                <li key={i}>
                  {e.path}: {e.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Tabs defaultValue="content" className="min-w-0">
          <TabsList>
            <TabsTrigger value="content">{t("presentations.tab.content")}</TabsTrigger>
            <TabsTrigger value="json">{t("presentations.tab.json")}</TabsTrigger>
            <TabsTrigger value="share">{t("presentations.tab.share")}</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("presentations.details")}</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="pe-title">{t("presentations.col.title")}</FieldLabel>
                    <Input id="pe-title" dir={dir} value={String(draft.title ?? "")} onChange={(e) => change({ ...draft, title: e.target.value })} />
                  </Field>
                  {doc.kind !== "page" ? (
                    <Field>
                      <FieldLabel htmlFor="pe-subtitle">{t("presentations.subtitle")}</FieldLabel>
                      <Input id="pe-subtitle" dir={dir} value={String(draft.subtitle ?? "")} onChange={(e) => change({ ...draft, subtitle: e.target.value })} />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="pe-desc">{t("presentations.description")}</FieldLabel>
                      <Input id="pe-desc" dir={dir} value={String(draft.description ?? "")} onChange={(e) => change({ ...draft, description: e.target.value })} />
                    </Field>
                  )}
                  {doc.kind === "report" ? (
                    <Field>
                      <FieldLabel htmlFor="pe-summary">{t("presentations.export.summary")}</FieldLabel>
                      <Textarea id="pe-summary" dir={dir} rows={3} value={String(draft.summary ?? "")} onChange={(e) => change({ ...draft, summary: e.target.value })} />
                    </Field>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="pe-company">{t("presentations.customer.company")}</FieldLabel>
                      <Input id="pe-company" value={meta.company} onChange={(e) => setMeta((m) => ({ ...m, company: e.target.value }))} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pe-name">{t("presentations.customer.name")}</FieldLabel>
                      <Input id="pe-name" value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pe-email">{t("presentations.customer.email")}</FieldLabel>
                      <Input id="pe-email" dir="ltr" type="email" value={meta.email} onChange={(e) => setMeta((m) => ({ ...m, email: e.target.value }))} />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="pe-status">{t("presentations.col.status")}</FieldLabel>
                      <Select value={meta.status} onValueChange={(v) => setMeta((m) => ({ ...m, status: (v as Status) ?? "draft" }))}>
                        <SelectTrigger id="pe-status" className="w-full">
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
                      <FieldDescription>{t("presentations.statusHelp")}</FieldDescription>
                    </Field>
                    {doc.kind === "page" ? (
                      <Field>
                        <FieldLabel htmlFor="pe-style">{t("presentations.style")}</FieldLabel>
                        <Select value={meta.style} onValueChange={(v) => setMeta((m) => ({ ...m, style: String(v ?? "minimal") }))}>
                          <SelectTrigger id="pe-style" className="w-full">
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
                      </Field>
                    ) : null}
                  </div>
                </FieldGroup>
              </CardContent>
            </Card>

            {doc.kind === "report" ? (
              <ReportOutline t={t} draft={draft} change={change} dir={dir} />
            ) : (
              <ItemList
                t={t}
                kind={doc.kind}
                items={(draft[ITEMS_KEY[doc.kind]] as Obj[] | undefined) ?? []}
                onChange={(items) => change({ ...draft, [ITEMS_KEY[doc.kind]]: items })}
                pages={pages.filter((p) => p.id !== doc.id)}
              />
            )}
          </TabsContent>

          <TabsContent value="json">
            <JsonEditor t={t} value={draft} onChange={change} />
          </TabsContent>

          <TabsContent value="share">
            <SharePanel t={t} doc={doc} locale={locale} lang={lang} onChanged={() => getPresentation(doc.id).then((d) => setDoc(d))} />
          </TabsContent>
        </Tabs>

        <section aria-label={t("presentations.preview")} className="min-w-0 xl:sticky xl:top-20 xl:self-start">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <EyeIcon className="size-4" aria-hidden />
              {t("presentations.preview")}
            </h3>
            {doc.formats?.length ? (
              <div className="flex gap-1">
                {doc.formats.map((f) => (
                  <Button key={f} variant="outline" size="sm" nativeButton={false} render={<a href={`${presentationsHref(lang, namespace, doc.id)}/export/${f}`} download />}>
                    <DownloadIcon />
                    {t(`presentations.format.${f}`)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="h-[70vh] overflow-auto rounded-xl border" data-testid="live-preview">
            <PresTheme className="min-h-full">
              <Preview kind={doc.kind} draft={draft} style={meta.style} lang={lang} dir={dir} embeds={embeds} t={t} namespace={namespace} />
            </PresTheme>
          </div>
        </section>
      </div>
    </div>
  )
}

function Preview({
  kind,
  draft,
  style,
  lang,
  dir,
  embeds,
  t,
  namespace,
}: {
  kind: Detail["kind"]
  draft: Obj
  style: string
  lang: PLocale
  dir: "ltr" | "rtl"
  embeds: Record<string, { style: string; content: PageContent }>
  t: T
  namespace: string
}) {
  // A draft mid-edit can be shaped wrongly; show the error rather than crash the editor.
  try {
    if (kind === "deck") {
      const c = draft as unknown as DeckContent
      if (!Array.isArray(c.slides) || c.slides.length === 0) return <p className="p-4 text-sm text-muted-foreground">{t("presentations.previewEmpty")}</p>
      return <DeckViewer content={c} embeds={embeds} dir={dir} showNotes fill={false} embedHref={(docId) => presentationsHref(lang, namespace, docId)} />
    }
    if (kind === "report") {
      const c = draft as unknown as ReportContent
      if (!Array.isArray(c.sections)) return <p className="p-4 text-sm text-muted-foreground">{t("presentations.previewEmpty")}</p>
      return <ReportView content={c} locale={lang} dir={dir} labels={{ summary: t("presentations.export.summary"), contents: t("presentations.report.contents") }} />
    }
    const c = draft as unknown as PageContent
    if (!Array.isArray(c.sections)) return <p className="p-4 text-sm text-muted-foreground">{t("presentations.previewEmpty")}</p>
    return <PagePreview content={c} style={style} dir={dir} />
  } catch {
    return <p className="p-4 text-sm text-destructive">{t("presentations.previewBroken")}</p>
  }
}

function summaryOf(item: Obj): string {
  for (const k of ["title", "heading", "quote", "text", "code", "document_id"]) {
    if (typeof item[k] === "string" && item[k]) return String(item[k]).slice(0, 80)
  }
  return ""
}

function ItemList({
  t,
  kind,
  items,
  onChange,
  pages,
  label,
}: {
  t: T
  kind: Detail["kind"]
  items: Obj[]
  onChange: (items: Obj[]) => void
  pages: Summary[]
  label?: string
}) {
  const [open, setOpen] = useState<number | null>(null)
  const [type, setType] = useState(Object.keys(ITEM_TEMPLATES[kind])[0])
  const types = Object.keys(ITEM_TEMPLATES[kind])
  const embedBlocked = kind === "deck" && type === "embed" && pages.length === 0

  const add = () => {
    const item = clone(ITEM_TEMPLATES[kind][type])
    if (kind === "deck" && type === "embed") item.document_id = pages[0]?.id ?? ""
    onChange([...items, item])
    setOpen(items.length)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label ?? t(`presentations.items.${kind}`)}</CardTitle>
        <CardDescription>{t("presentations.itemsHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ol className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="rounded-lg border" data-testid="outline-item">
              <div className="flex items-center gap-2 p-2">
                <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <Badge variant="secondary">{t(`presentations.type.${String(item.type)}`)}</Badge>
                <button type="button" className="min-w-0 flex-1 truncate text-start text-sm hover:underline" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  {summaryOf(item) || t("presentations.edit")}
                </button>
                <Button variant="ghost" size="icon-xs" onClick={() => onChange(move(items, i, i - 1))} disabled={i === 0} aria-label={t("presentations.moveUp")}>
                  <ArrowUpIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => onChange(move(items, i, i + 1))} disabled={i === items.length - 1} aria-label={t("presentations.moveDown")}>
                  <ArrowDownIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={t("presentations.remove")}>
                  <Trash2Icon />
                </Button>
              </div>
              {open === i ? (
                <div className="border-t p-2">
                  {kind === "deck" && item.type === "embed" ? (
                    <Select value={String(item.document_id ?? "")} onValueChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, document_id: String(v) } : x)))}>
                      <SelectTrigger className="mb-2 w-full" aria-label={t("presentations.embedPick")}>
                        <SelectValue>{(v) => pages.find((p) => p.id === v)?.title ?? t("presentations.embedPick")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {pages.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <JsonEditor t={t} value={item} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} rows={10} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Select value={type} onValueChange={(v) => setType(String(v))}>
            <SelectTrigger className="w-44" aria-label={t("presentations.addType")}>
              <SelectValue>{(v) => t(`presentations.type.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {types.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {t(`presentations.type.${ty}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={add} disabled={embedBlocked}>
            <PlusIcon />
            {t("presentations.add")}
          </Button>
          {embedBlocked ? <span className="text-xs text-muted-foreground">{t("presentations.embedNone")}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ReportOutline({ t, draft, change, dir }: { t: T; draft: Obj; change: (v: Obj) => void; dir: "ltr" | "rtl" }) {
  const sections = (draft.sections as Obj[] | undefined) ?? []
  const set = (next: Obj[]) => change({ ...draft, sections: next })
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i} className="space-y-2 rounded-xl border p-3">
          <div className="flex items-center gap-2">
            <Input
              dir={dir}
              value={String(s.heading ?? "")}
              onChange={(e) => set(sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))}
              aria-label={t("presentations.sectionHeading")}
            />
            <Button variant="ghost" size="icon-sm" onClick={() => set(move(sections, i, i - 1))} disabled={i === 0} aria-label={t("presentations.moveUp")}>
              <ArrowUpIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => set(move(sections, i, i + 1))} disabled={i === sections.length - 1} aria-label={t("presentations.moveDown")}>
              <ArrowDownIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => set(sections.filter((_, j) => j !== i))} aria-label={t("presentations.remove")}>
              <Trash2Icon />
            </Button>
          </div>
          <ItemList
            t={t}
            kind="report"
            label={t("presentations.items.report")}
            items={(s.blocks as Obj[] | undefined) ?? []}
            onChange={(blocks) => set(sections.map((x, j) => (j === i ? { ...x, blocks } : x)))}
            pages={[]}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => set([...sections, newReportSection()])}>
        <PlusIcon />
        {t("presentations.addSection")}
      </Button>
    </div>
  )
}

function JsonEditor({ t, value, onChange, rows = 28 }: { t: T; value: Obj; onChange: (v: Obj) => void; rows?: number }) {
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
    <div className="space-y-2">
      <Textarea
        dir="ltr"
        spellCheck={false}
        rows={rows}
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

function SharePanel({ t, doc, locale, lang, onChanged }: { t: T; doc: Detail; locale: string; lang: PLocale; onChanged: () => void }) {
  const [label, setLabel] = useState("")
  const [shareLang, setShareLang] = useState<PLocale>(lang)
  const [days, setDays] = useState("0")
  const [created, setCreated] = useState<ShareCreated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tag = locale === "ar" ? "ar-EG" : "en-US"
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—")

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      setCreated(await createShare(doc.id, { label, locale: shareLang, expires_in_days: Number(days) }))
      setLabel("")
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t("presentations.stats.views"), doc.view_count],
          [t("presentations.stats.downloads"), doc.download_count],
          [t("presentations.stats.activeLinks"), doc.active_shares],
          [t("presentations.col.lastViewed"), when(doc.last_viewed_at)],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("presentations.share.new")}</CardTitle>
          <CardDescription>{t("presentations.share.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="sh-label">{t("presentations.share.label")}</FieldLabel>
              <Input id="sh-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="sh-lang">{t("presentations.language")}</FieldLabel>
              <Select value={shareLang} onValueChange={(v) => setShareLang((v as PLocale) ?? "en")}>
                <SelectTrigger id="sh-lang" className="w-full">
                  <SelectValue>{(v) => t(`presentations.locale.${String(v)}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["en", "ar"] as PLocale[]).map((l) => (
                    <SelectItem key={l} value={l} disabled={!doc.content[l]}>
                      {t(`presentations.locale.${l}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="sh-exp">{t("presentations.share.expires")}</FieldLabel>
              <Select value={days} onValueChange={(v) => setDays(String(v))}>
                <SelectTrigger id="sh-exp" className="w-full">
                  <SelectValue>{(v) => (v === "0" ? t("presentations.share.never") : t("presentations.share.days", { n: String(v) }))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["0", "7", "30", "90"].map((d) => (
                    <SelectItem key={d} value={d}>
                      {d === "0" ? t("presentations.share.never") : t("presentations.share.days", { n: d })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Button onClick={create} disabled={busy || !doc.content[shareLang]}>
            {t("presentations.share.create")}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {created ? (
            <Alert data-testid="share-created">
              <AlertTitle>{t("presentations.share.created")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input readOnly value={created.url} dir="ltr" className="font-mono text-xs" aria-label={t("presentations.share.url")} />
                  <CopyButton text={created.url} variant="outline" aria-label={t("presentations.share.copy")} />
                </div>
                {!created.recoverable ? <p>{t("presentations.share.once")}</p> : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("presentations.share.links")}</CardTitle>
        </CardHeader>
        <CardContent>
          {doc.shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("presentations.share.none")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("presentations.share.label")}</TableHead>
                    <TableHead>{t("presentations.col.views")}</TableHead>
                    <TableHead>{t("presentations.col.lastViewed")}</TableHead>
                    <TableHead>{t("presentations.share.expires")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.shares.map((s) => (
                    <TableRow key={s.id} data-testid="share-row">
                      <TableCell>
                        <div className="font-medium">{s.label || t("presentations.share.unnamed")}</div>
                        <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {s.locale}/p/{s.hint}…
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {s.view_count} / {s.download_count}
                      </TableCell>
                      <TableCell className="text-xs">{when(s.last_viewed_at)}</TableCell>
                      <TableCell className="text-xs">
                        {s.revoked_at ? (
                          <Badge variant="destructive">{t("presentations.share.revoked")}</Badge>
                        ) : !s.active ? (
                          <Badge variant="outline">{t("presentations.share.expired")}</Badge>
                        ) : s.expires_at ? (
                          when(s.expires_at)
                        ) : (
                          t("presentations.share.never")
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {s.active && s.url ? (
                            <>
                              <CopyButton text={s.url} variant="ghost" size="icon-sm" aria-label={t("presentations.share.copy")} />
                              <Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={t("presentations.share.open")} />}>
                                <ExternalLinkIcon />
                              </Button>
                            </>
                          ) : null}
                          {s.active ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!window.confirm(t("presentations.share.confirmRevoke"))) return
                                await revokeShare(doc.id, s.id)
                                onChanged()
                              }}
                            >
                              {t("presentations.share.revoke")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {doc.shares.some((s) => s.active && !s.url) ? <p className="mt-2 text-xs text-muted-foreground">{t("presentations.share.notRecoverable")}</p> : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
