"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"

import { PROVIDER_MARKS, useLoginMethods } from "@/components/auth/parts"
import { StatusLine } from "@/components/account/section"
import { ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { disconnectIdentity, listIdentities, type ConnectedIdentity } from "@/lib/account"
import { authMessage, AuthError, connectURL, PROVIDER_NAMES, PROVIDERS, type Provider } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"

// What the link callback may report as ?connect_error=<reason>.
const REASONS = ["conflict", "taken", "signin", "session", "cancelled", "state", "failed"]

/**
 * Google / GitHub / Apple identities that sign in as this account, ported from fadymondy.com-v2.
 * Connect is the provider's redirect flow in link mode, returning to `returnPath` with
 * ?connected= or ?connect_error=; Disconnect is refused (and disabled) when it is the only way in.
 * Connect renders only for providers the API advertises, so it never dead-ends.
 */
export function ConnectedAccounts({ returnPath }: { returnPath: string }) {
  const { t, formatDate } = useTranslations()
  const methods = useLoginMethods()
  const list = useSWR<ConnectedIdentity[]>("/api/me/identities", listIdentities, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [busy, setBusy] = useState<Provider | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  // The callback's result, read once and removed from the address bar so a reload does not repeat it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get("connected") as Provider | null
    const reason = params.get("connect_error")
    const provider = (params.get("provider") ?? connected) as Provider | null
    if (!connected && !reason) return
    const name = provider && PROVIDER_NAMES[provider] ? PROVIDER_NAMES[provider] : ""
    if (connected && PROVIDER_NAMES[connected]) {
      setNotice({ ok: true, text: t("account.connections.connected", { provider: PROVIDER_NAMES[connected] }) })
    } else if (reason) {
      const key = REASONS.includes(reason) ? reason : "failed"
      setNotice({ ok: false, text: t(`account.connections.error.${key}`, { provider: name }) })
    }
    for (const k of ["connected", "connect_error", "provider"]) params.delete(k)
    const qs = params.toString()
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash)
  }, [t])

  async function disconnect(provider: Provider) {
    setBusy(provider)
    setNotice(null)
    try {
      await disconnectIdentity(provider)
      setNotice({ ok: true, text: t("account.connections.disconnected", { provider: PROVIDER_NAMES[provider] }) })
    } catch (err) {
      setNotice({
        ok: false,
        text:
          err instanceof AuthError && err.code === "last_method"
            ? t("account.connections.lastMethod")
            : authMessage(err, t),
      })
    } finally {
      setBusy(null)
      void list.mutate()
    }
  }

  if (list.isLoading) return <LoadingRows rows={3} />
  if (list.error) return <ErrorState error={list.error} />

  return (
    <>
      {notice ? (
        <div className="border-t border-line px-6 py-4">
          <StatusLine notice={notice} />
        </div>
      ) : null}
      <ul className="divide-y divide-line border-y border-line">
        {PROVIDERS.map((provider) => {
          const Mark = PROVIDER_MARKS[provider]
          const linked = list.data?.find((i) => i.provider === provider)
          const available = !!methods?.providers[provider]
          return (
            <li key={provider} className="flex flex-wrap items-center gap-3 px-6 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center border border-line bg-grid-card [&_svg]:size-4">
                <Mark />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-grid-fg" dir="ltr">
                  <bdi>{PROVIDER_NAMES[provider]}</bdi>
                </p>
                {linked ? (
                  <p className="text-xs text-grid-muted">
                    {linked.email ? (
                      <bdi dir="ltr" className="font-mono break-all">
                        {linked.email}
                      </bdi>
                    ) : null}
                    {linked.email ? " · " : ""}
                    {linked.last_used_at
                      ? t("account.connections.lastUsed", { date: formatDate(linked.last_used_at) })
                      : t("account.connections.connectedOn", { date: formatDate(linked.created_at) })}
                  </p>
                ) : (
                  <p className="text-xs text-grid-muted">
                    {available ? t("account.connections.notConnected") : t("account.connections.unavailable")}
                  </p>
                )}
                {linked && !linked.can_unlink ? (
                  <p className="mt-1 max-w-[60ch] text-xs text-pretty text-grid-muted">{t("account.connections.lastMethod")}</p>
                ) : null}
              </div>
              {linked ? (
                <Button variant="outline" size="sm" disabled={!linked.can_unlink || busy !== null} onClick={() => void disconnect(provider)}>
                  {busy === provider ? t("common.working") : t("account.connections.disconnect")}
                </Button>
              ) : available ? (
                <Button size="sm" nativeButton={false} render={<a href={connectURL(provider, returnPath)} />}>
                  {t("account.connections.connect")}
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
