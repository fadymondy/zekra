"use client"

// The MCP OAuth consent screen. Claude.ai, Claude Desktop, ChatGPT and other MCP clients send
// the user here (the authorization_endpoint); the user picks which brains the app may use, and
// the API answers with the redirect back to the client. Contract: plugins/brain/internal/brain/oauth.go.
import { useEffect, useMemo, useState } from "react"
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react"

import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { LoadingRows } from "@/components/states"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

type Brain = { namespace: string; role: string; canWrite: boolean; memories: number }
type AuthorizeRequest = {
  client: { id: string; name: string; uri?: string }
  redirect_uri: string
  redirect_host: string
  loopback_redirect: boolean
  requested_scopes: { scope: string; write: boolean; description: string }[]
  write_requested: boolean
  brains: Brain[]
}
type Pick = { on: boolean; write: boolean }

const PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]

export default function AuthorizePage() {
  const { t, locale, formatNumber } = useTranslations()
  useDocumentTitle(t("oauth.title"))
  const me = useMe()
  const [query, setQuery] = useState<string | null>(null)
  const [req, setReq] = useState<AuthorizeRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, Pick>>({})
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => setQuery(window.location.search), [])

  useEffect(() => {
    if (query === null) return
    let dead = false
    ;(async () => {
      const res = await fetch(`/api/oauth/authorize/request${query}`, { credentials: "same-origin", cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (dead) return
      if (res.status === 401) {
        window.location.replace(`/${locale}/login?next=${encodeURIComponent(window.location.pathname + query)}`)
        return
      }
      if (!res.ok) {
        // Follow only a server-vetted redirect; otherwise the client's redirect isn't trusted yet.
        if (body.redirect_to) window.location.replace(body.redirect_to)
        else setError(body.error_description || body.error || t("oauth.invalid"))
        return
      }
      const r = body as AuthorizeRequest
      setReq(r)
      // Pre-select a lone brain; anything more is an explicit choice.
      if (r.brains.length === 1) {
        const b = r.brains[0]
        setPicked({ [b.namespace]: { on: true, write: r.write_requested && b.canWrite } })
      }
    })().catch(() => {
      if (!dead) setError(t("common.networkError"))
    })
    return () => {
      dead = true
    }
  }, [query, locale, t])

  const chosen = useMemo(
    () => Object.entries(picked).filter(([, v]) => v.on).map(([namespace, v]) => ({ namespace, write: v.write })),
    [picked],
  )

  async function decide(approve: boolean) {
    if (query === null) return
    setBusy(true)
    setError(null)
    const sp = new URLSearchParams(query)
    const params = Object.fromEntries(PARAMS.map((k) => [k, sp.get(k) ?? ""]))
    try {
      const r = await api<{ redirect_to: string }>("/api/oauth/authorize/decision", {
        json: { ...params, approve, namespaces: approve ? chosen : [] },
      })
      setLeaving(true)
      window.location.replace(r.redirect_to)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
      setBusy(false)
    }
  }

  const setPick = (ns: string, next: Pick) => setPicked((p) => ({ ...p, [ns]: next }))

  return (
    <PublicFrame eyebrow={t("oauth.eyebrow")} title={t("oauth.title")} description={t("oauth.description")}>
      <PublicPanel className="py-8">
        {error && !req ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : !req || leaving ? (
          <div className="space-y-2">
            <p className="text-sm text-grid-muted">{leaving ? t("oauth.redirecting") : t("oauth.loading")}</p>
            <LoadingRows rows={2} />
          </div>
        ) : (
          <div className="mx-auto flex max-w-lg flex-col gap-6">
            <div className="flex items-start gap-3 border border-line bg-grid-card p-4">
              <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-grid-action" />
              <div className="min-w-0 space-y-1 text-sm">
                <p>
                  <span dir="auto" className="font-medium text-grid-fg">
                    {req.client.name || req.client.id}
                  </span>{" "}
                  <span className="text-grid-muted">({t("oauth.claims")})</span>
                </p>
                <p className="text-grid-muted">
                  {t("oauth.redirectsTo")}{" "}
                  <span dir="ltr" className="font-mono text-grid-fg">
                    {req.redirect_host}
                  </span>
                </p>
              </div>
            </div>

            {req.loopback_redirect ? (
              <p className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-grid-fg">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                {t("oauth.loopback")}
              </p>
            ) : null}

            <div>
              <p className="grid-micro mb-2">{t("oauth.permissions")}</p>
              <ul className="space-y-1 text-sm text-grid-body">
                {req.requested_scopes.map((s) => (
                  <li key={s.scope} className="flex items-center gap-2">
                    <span className={cn("size-1.5 shrink-0", s.write ? "bg-amber-500" : "bg-grid-action")} aria-hidden />
                    {s.description}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="grid-micro mb-2">{t("oauth.brains")}</p>
              {req.brains.length === 0 ? (
                <p className="text-sm text-grid-muted">{t("oauth.noBrains")}</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {req.brains.map((b) => {
                    const cur = picked[b.namespace] ?? { on: false, write: false }
                    const canW = req.write_requested && b.canWrite
                    return (
                      <li key={b.namespace} className="flex flex-wrap items-center gap-3 py-2.5">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <Checkbox
                            checked={cur.on}
                            onCheckedChange={(on) => setPick(b.namespace, { on: !!on, write: !!on && (cur.write || canW) })}
                          />
                          <span dir="ltr" className="truncate font-medium text-grid-fg">
                            {b.namespace}
                          </span>
                          <span className="text-xs text-grid-muted">{t("oauth.memories", { n: formatNumber(b.memories) })}</span>
                        </label>
                        {req.write_requested ? (
                          b.canWrite ? (
                            <div className="inline-flex border border-line text-xs" role="group">
                              {[false, true].map((w) => (
                                <button
                                  key={String(w)}
                                  type="button"
                                  disabled={!cur.on}
                                  aria-pressed={cur.on && cur.write === w}
                                  onClick={() => setPick(b.namespace, { on: true, write: w })}
                                  className={cn(
                                    "px-2.5 py-1 disabled:opacity-50",
                                    cur.on && cur.write === w ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted",
                                  )}
                                >
                                  {w ? t("oauth.readWrite") : t("oauth.read")}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-grid-muted">{t("oauth.readOnlyRole")}</span>
                          )
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : chosen.length === 0 && req.brains.length > 0 ? (
              <p className="text-sm text-grid-muted">{t("oauth.pickOne")}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || chosen.length === 0} onClick={() => decide(true)}>
                {busy ? t("common.working") : t("oauth.allow")}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
                {t("oauth.deny")}
              </Button>
            </div>
            <div className="space-y-1 text-xs text-grid-muted">
              {me.data ? <p>{t("oauth.signedInAs", { email: me.data.email })}</p> : null}
              <p>{t("oauth.expires")}</p>
            </div>
          </div>
        )}
      </PublicPanel>
    </PublicFrame>
  )
}
