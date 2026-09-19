"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { CheckCircle2Icon, CircleDashedIcon, Loader2Icon, PlusIcon, RefreshCwIcon, StarIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/lib/i18n"
import { addDomain, deleteDomain, listDomains, setDefaultDomain, verifyDomain, type DomainList } from "@/lib/presentations/api"
import type { ShareDomain } from "@/lib/presentations/types"

/*
A brain's own hosts for share links (brain settings → "Share domains"): add a host, see the
DNS records the API asks for (a CNAME to the app and a TXT record that proves ownership),
verify, choose the default, remove. The records come from the API; nothing is assumed here.
Changes need the brain's owner or an admin (403 otherwise), so others only see the list.
Until the API has the endpoints (404) the section says links use the app's host.
*/

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

function Records({ d }: { d: ShareDomain }) {
  const { t } = useTranslations()
  const cname = d.cname_target
  if (!cname && !d.txt_value) return <p className="text-xs text-grid-muted">{t("presentations.domains.noRecords")}</p>
  return (
    <div className="grid gap-3 text-xs" data-testid="domain-dns">
      <p className="text-grid-muted">{t("presentations.domains.dnsHelp")}</p>
      {cname ? (
        <div className="grid gap-1">
          <span className="font-medium">
            CNAME · <bdi dir="ltr">{d.cname_name ?? d.host}</bdi>
          </span>
          <CopyField value={cname} label="CNAME" />
        </div>
      ) : null}
      {d.txt_value ? (
        <div className="grid gap-1">
          <span className="font-medium">
            TXT · <bdi dir="ltr">{d.txt_name ?? d.host}</bdi>
          </span>
          <CopyField value={d.txt_value} label="TXT" />
        </div>
      ) : null}
    </div>
  )
}

export function ShareDomains({ namespace, canEdit }: { namespace: string; canEdit: boolean }) {
  const { t } = useTranslations()
  const [list, setList] = useState<DomainList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [host, setHost] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(
    () =>
      listDomains(namespace)
        .then((d) => (setList(d), setError(null)))
        .catch((err) => setError(err instanceof Error ? err.message : String(err))),
    [namespace],
  )
  useEffect(() => void load(), [load])

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    try {
      await fn()
      if (done) toast.success(done)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    const h = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    if (!HOST.test(h)) return void toast.error(t("presentations.domains.invalidHost"))
    void run("add", async () => (await addDomain(namespace, h), setHost("")), t("presentations.domains.added"))
  }

  if (error) return <p className="text-sm text-grid-danger-text">{error}</p>
  if (!list) return <p className="text-sm text-grid-muted">…</p>
  const appHost = list.builtinHost || (typeof window === "undefined" ? "" : window.location.host)
  if (!list.supported) {
    return (
      <p className="text-sm text-grid-muted" data-testid="domains-unsupported">
        {t("presentations.domains.unsupported", { host: appHost })}
      </p>
    )
  }

  return (
    <div className="grid gap-4" data-testid="share-domains">
      <ul className="grid gap-3">
        <li className="flex flex-wrap items-center gap-2 border border-line p-3 text-sm">
          <bdi dir="ltr" className="font-mono">
            {appHost}
          </bdi>
          <Badge variant="outline">{t("presentations.domains.builtIn")}</Badge>
          {!list.domains.some((d) => d.default) ? <Badge variant="secondary">{t("presentations.domains.default")}</Badge> : null}
        </li>
        {list.domains.map((d) => (
          <li key={d.id} className="grid gap-3 border border-line p-3 text-sm" data-testid="domain-row">
            <div className="flex flex-wrap items-center gap-2">
              <bdi dir="ltr" className="font-mono">
                {d.host}
              </bdi>
              {d.verified ? (
                <Badge variant="secondary">
                  <CheckCircle2Icon />
                  {t("presentations.domains.verified")}
                </Badge>
              ) : (
                <Badge variant="outline">
                  <CircleDashedIcon />
                  {t("presentations.domains.pending")}
                </Badge>
              )}
              {d.default ? <Badge>{t("presentations.domains.default")}</Badge> : null}
              {canEdit ? (
                <span className="ms-auto flex flex-wrap gap-1">
                  {!d.verified ? (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(`v${d.id}`, async () => {
                      const out = await verifyDomain(d.id)
                      if (!out.verified) throw new Error(out.last_error || t("presentations.domains.notYet"))
                    }, t("presentations.domains.verifiedNow"))}>
                      {busy === `v${d.id}` ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                      {t("presentations.domains.verify")}
                    </Button>
                  ) : !d.default ? (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(`d${d.id}`, () => setDefaultDomain(d.id))}>
                      <StarIcon />
                      {t("presentations.domains.makeDefault")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => window.confirm(t("presentations.domains.confirmRemove", { host: d.host })) && run(`x${d.id}`, () => deleteDomain(d.id))} aria-label={t("presentations.remove")}>
                    <Trash2Icon />
                  </Button>
                </span>
              ) : null}
            </div>
            {!d.verified ? <Records d={d} /> : null}
            {d.last_error && !d.verified ? <p className="text-xs text-grid-danger-text">{d.last_error}</p> : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input dir="ltr" className="w-64" value={host} onChange={(e) => setHost(e.target.value)} placeholder="share.example.com" aria-label={t("presentations.domains.host")} />
          <Button type="submit" variant="outline" disabled={busy !== null || !host.trim()}>
            {busy === "add" ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            {t("presentations.domains.add")}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
