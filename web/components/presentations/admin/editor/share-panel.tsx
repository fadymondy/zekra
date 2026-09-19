"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, ExternalLinkIcon, KeyRoundIcon, PencilIcon, RefreshCwIcon, XIcon } from "lucide-react"

import { ApiError, createShare, listDomains, reissueShare, revokeShare, updateShare, type DomainList } from "@/lib/presentations/api"
import type { Detail, PLocale, Share } from "@/lib/presentations/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CopyButton } from "../copy-button"

/*
Share links. A link's address contains its secret token, which the API stores sealed: it
can hand the full URL back only for links it can unseal (`url` is set). Every row says
which case it is — the full URL with Copy and Open, or plainly "this link can't be shown
again" with two ways out: reissue it (one click: the API revokes it and makes a new one with
the same label, language, expiry and domain) or make a second link with the form prefilled,
leaving the old one working. A new link is always shown in full, and stays on its row for
the rest of the session. Label, expiry and domain are edited in place (PATCH).
*/

type T = (key: string, vars?: Record<string, string | number>) => string
const APP = "__app__"
const PRESETS = ["0", "7", "30", "90"]

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}

function UrlBox({ url, t }: { url: string; t: T }) {
  return (
    <div className="flex items-center gap-1" data-testid="share-url">
      <Input readOnly value={url} dir="ltr" className="h-8 min-w-0 flex-1 font-mono text-xs" aria-label={t("presentations.share.url")} onFocus={(e) => e.currentTarget.select()} />
      <CopyButton text={url} variant="outline" size="sm" aria-label={t("presentations.share.copy")}>
        {t("presentations.share.copy")}
      </CopyButton>
      <Button variant="outline" size="sm" nativeButton={false} render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
        <ExternalLinkIcon />
        {t("presentations.share.open")}
      </Button>
    </div>
  )
}

export function SharePanel({ t, doc, locale, lang, namespace, onChanged }: { t: T; doc: Detail; locale: string; lang: PLocale; namespace: string; onChanged: () => void }) {
  const [label, setLabel] = useState("")
  const [shareLang, setShareLang] = useState<PLocale>(lang)
  const [days, setDays] = useState("0")
  const [domain, setDomain] = useState(APP)
  const [domains, setDomains] = useState<DomainList>({ domains: [], supported: false, builtinHost: "" })
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; label: string; days: string; domain: string } | null>(null)
  const [canEdit, setCanEdit] = useState(true)
  const form = useRef<HTMLDivElement>(null)
  const tag = locale === "ar" ? "ar-EG" : "en-US"
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—")
  const appHost = domains.builtinHost || (typeof window === "undefined" ? "" : window.location.host)

  useEffect(() => {
    listDomains(namespace)
      .then((d) => {
        setDomains(d)
        const def = d.domains.find((x) => x.default && x.verified)
        if (def) setDomain(def.id)
      })
      .catch(() => undefined)
  }, [namespace])

  const usable = useMemo(() => domains.domains.filter((d) => d.verified), [domains])
  const domainName = (s: Share) => s.domain || domains.domains.find((d) => d.id === s.domain_id)?.host || hostOf(s.url || urls[s.id] || "") || appHost
  const dayOptions = PRESETS.includes(days) ? PRESETS : [...PRESETS, days]
  const daysLabel = (d: string) => (d === "0" ? t("presentations.share.never") : t("presentations.share.days", { n: d }))

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await createShare(doc.id, { label, locale: shareLang, expires_in_days: Number(days), ...(domain !== APP ? { domain_id: domain } : {}) })
      setUrls((m) => ({ ...m, [out.share.id]: out.url }))
      setCreatedId(out.share.id)
      setLabel("")
      setReplacing(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const replace = (s: Share) => {
    setLabel(s.label)
    setShareLang(s.locale)
    const left = s.expires_at ? Math.max(1, Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 86400000)) : 0
    setDays(String(left))
    if (s.domain_id && usable.some((d) => d.id === s.domain_id)) setDomain(s.domain_id)
    setReplacing(s.id)
    form.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    form.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true })
  }

  const revoke = async (s: Share) => {
    if (!window.confirm(t("presentations.share.confirmRevoke"))) return
    await revokeShare(doc.id, s.id)
    onChanged()
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const was = doc.shares.find((s) => s.id === editing.id)
      await updateShare(doc.id, editing.id, {
        label: editing.label,
        ...(editing.days !== "keep" ? { expires_in_days: Number(editing.days) } : {}),
        ...(domains.supported && editing.domain !== (was?.domain_id || APP) ? { domain_id: editing.domain === APP ? "" : editing.domain } : {}),
      })
      setEditing(null)
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
        setCanEdit(false)
        setEditing(null)
        setError(t("presentations.share.editUnsupported"))
      } else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const reissue = async (s: Share) => {
    if (!window.confirm(t("presentations.share.confirmReissue"))) return
    setBusy(true)
    setError(null)
    try {
      const out = await reissueShare(doc.id, s.id)
      setUrls((m) => ({ ...m, [out.share.id]: out.url }))
      setCreatedId(out.share.id)
      onChanged()
      form.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    } catch (err) {
      setError(err instanceof ApiError && (err.status === 404 || err.status === 405) ? t("presentations.share.reissueUnsupported") : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const created = createdId ? urls[createdId] : null

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

      <Card ref={form}>
        <CardHeader>
          <CardTitle>{replacing ? t("presentations.share.replaceTitle") : t("presentations.share.new")}</CardTitle>
          <CardDescription>{replacing ? t("presentations.share.replaceHelp") : t("presentations.share.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                  <SelectValue>{(v) => daysLabel(String(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {dayOptions.map((d) => (
                    <SelectItem key={d} value={d}>
                      {daysLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="sh-domain">{t("presentations.share.domain")}</FieldLabel>
              <Select value={domain} onValueChange={(v) => setDomain(String(v ?? APP))}>
                <SelectTrigger id="sh-domain" className="w-full" data-testid="share-domain">
                  <SelectValue>{(v) => <span dir="ltr">{v === APP ? appHost : (usable.find((d) => d.id === v)?.host ?? appHost)}</span>}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={APP}>
                    <span dir="ltr">{appHost}</span>
                  </SelectItem>
                  {usable.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span dir="ltr">{d.host}</span>
                      {d.default ? <Badge variant="secondary">{t("presentations.domains.default")}</Badge> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={create} disabled={busy || !doc.content[shareLang]} data-testid="share-create">
              {t("presentations.share.create")}
            </Button>
            {replacing ? (
              <Button variant="ghost" onClick={() => setReplacing(null)}>
                {t("common.cancel")}
              </Button>
            ) : null}
            <a className="text-xs text-muted-foreground underline underline-offset-4" href={`/${locale}/b/${encodeURIComponent(namespace)}/settings#share-domains`}>
              {t("presentations.share.manageDomains")}
            </a>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {created ? (
            <Alert data-testid="share-created">
              <AlertTitle>{t("presentations.share.created")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <UrlBox url={created} t={t} />
                <p>{t("presentations.share.keepIt")}</p>
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
            <ul className="grid gap-3">
              {doc.shares.map((s) => {
                const url = s.url || urls[s.id] || ""
                const isEditing = editing?.id === s.id
                return (
                  <li key={s.id} className="grid gap-2 rounded-lg border p-3" data-testid="share-row" data-recoverable={url ? "true" : "false"}>
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <>
                          <Input className="h-8 w-48" value={editing.label} maxLength={80} aria-label={t("presentations.share.label")} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                          <Select value={editing.days} onValueChange={(v) => setEditing({ ...editing, days: String(v) })}>
                            <SelectTrigger className="w-40" size="sm" aria-label={t("presentations.share.expires")}>
                              <SelectValue>{(v) => (v === "keep" ? t("presentations.share.keepExpiry") : daysLabel(String(v)))}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="keep">{t("presentations.share.keepExpiry")}</SelectItem>
                              {PRESETS.map((d) => (
                                <SelectItem key={d} value={d}>
                                  {daysLabel(d)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {usable.length ? (
                            <Select value={editing.domain} onValueChange={(v) => setEditing({ ...editing, domain: String(v ?? APP) })}>
                              <SelectTrigger className="w-48" size="sm" aria-label={t("presentations.share.domain")}>
                                <SelectValue>{(v) => <span dir="ltr">{v === APP ? appHost : (usable.find((d) => d.id === v)?.host ?? appHost)}</span>}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={APP}>
                                  <span dir="ltr">{appHost}</span>
                                </SelectItem>
                                {usable.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    <span dir="ltr">{d.host}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                          <Button size="icon-sm" onClick={saveEdit} disabled={busy} aria-label={t("presentations.save")}>
                            <CheckIcon />
                          </Button>
                          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label={t("common.cancel")}>
                            <XIcon />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{s.label || t("presentations.share.unnamed")}</span>
                          <Badge variant="outline">{t(`presentations.locale.${s.locale}`)}</Badge>
                          <Badge variant="outline" dir="ltr">
                            {domainName(s)}
                          </Badge>
                          {s.revoked_at ? <Badge variant="destructive">{t("presentations.share.revoked")}</Badge> : !s.active ? <Badge variant="outline">{t("presentations.share.expired")}</Badge> : null}
                          {s.active && canEdit ? (
                            <Button variant="ghost" size="icon-xs" onClick={() => setEditing({ id: s.id, label: s.label, days: "keep", domain: s.domain_id || APP })} aria-label={t("presentations.share.edit")}>
                              <PencilIcon />
                            </Button>
                          ) : null}
                        </>
                      )}
                      <span className="ms-auto flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                        <span>
                          {t("presentations.col.views")}: <bdi className="tabular-nums">{s.view_count} / {s.download_count}</bdi>
                        </span>
                        <span>
                          {t("presentations.col.lastViewed")}: {when(s.last_viewed_at)}
                        </span>
                        <span>
                          {t("presentations.share.expires")}: {s.expires_at ? when(s.expires_at) : t("presentations.share.never")}
                        </span>
                      </span>
                    </div>

                    {url ? (
                      s.active ? (
                        <UrlBox url={url} t={t} />
                      ) : (
                        <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {url}
                        </p>
                      )
                    ) : s.active ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2 text-xs" data-testid="share-sealed">
                        <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          {t("presentations.share.sealed")}{" "}
                          <bdi className="font-mono text-muted-foreground" dir="ltr">
                            {domainName(s)}/{s.locale}/p/{s.hint}…
                          </bdi>
                        </span>
                        <Button size="sm" onClick={() => reissue(s)} disabled={busy} data-testid="share-reissue">
                          <RefreshCwIcon />
                          {t("presentations.share.reissue")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => replace(s)} data-testid="share-replace">
                          {t("presentations.share.replace")}
                        </Button>
                      </div>
                    ) : null}

                    {s.active ? (
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => revoke(s)}>
                          {t("presentations.share.revoke")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
