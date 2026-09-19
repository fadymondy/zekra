"use client"

// Connected apps: the MCP clients (Claude.ai, ChatGPT, …) the user approved on the OAuth consent
// screen, with the brains each may use. Contract: plugins/brain/internal/brain/oauth.go (listGrants).
import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { AppWindowIcon, ChevronDownIcon, PlugZapIcon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { RowList, SectionHeader } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { noRetryOn4xx } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

type Grant = {
  id: string
  client_id: string
  client_name: string
  client_uri: string
  scopes: string[]
  namespaces: { namespace: string; write: boolean }[] | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

const KEY = "/api/oauth/grants"

function GrantRow({ g, onRevoke }: { g: Grant; onRevoke?: (g: Grant) => Promise<void> }) {
  const { t, formatDate, timeAgo } = useTranslations()
  const name = g.client_name || g.client_id
  const brains = g.namespaces ?? []
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3", g.revoked_at && "opacity-70")}>
      <AppWindowIcon className="size-4 shrink-0 text-grid-muted" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span dir="auto" className="font-medium text-grid-fg">
            {name}
          </span>
          {g.client_uri ? (
            <Ltr mono className="truncate text-xs text-grid-muted">
              {g.client_uri.replace(/^https?:\/\//, "")}
            </Ltr>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {brains.length === 0 ? (
            <span className="text-xs text-grid-muted">{t("apps.noBrains")}</span>
          ) : (
            brains.map((b) => (
              <Badge key={b.namespace} variant="outline" className="gap-1.5">
                <Ltr>{b.namespace}</Ltr>
                <span className={b.write ? "text-grid-warn" : "text-grid-muted"}>
                  {b.write ? t("apps.readWrite") : t("apps.read")}
                </span>
              </Badge>
            ))
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-xs text-grid-muted">
        {g.revoked_at ? (
          <span>{t("apps.revokedOn", { date: formatDate(g.revoked_at) })}</span>
        ) : (
          <span>{g.last_used_at ? t("apps.lastUsed", { when: timeAgo(g.last_used_at) }) : t("apps.neverUsed")}</span>
        )}
        <span>{t("apps.connected", { date: formatDate(g.created_at) })}</span>
      </div>
      {onRevoke ? (
        <ConfirmButton
          label={t("apps.revoke")}
          title={t("apps.revokeTitle", { name })}
          description={t("apps.revokeBody")}
          confirmLabel={t("apps.revoke")}
          onConfirm={() => onRevoke(g)}
        />
      ) : null}
    </li>
  )
}

export default function ConnectedAppsPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(t("apps.title"))
  const q = useSWR<Grant[]>(KEY, () => api<{ grants: Grant[] }>(KEY).then((r) => r.grants ?? []), noRetryOn4xx)
  const [showRevoked, setShowRevoked] = useState(false)

  const all = q.data ?? []
  const active = all.filter((g) => !g.revoked_at)
  const revoked = all.filter((g) => g.revoked_at)

  async function revoke(g: Grant) {
    try {
      await api(`/api/oauth/grants/${encodeURIComponent(g.id)}/revoke`, { method: "POST" })
      toast.success(t("apps.revoked"))
      await q.mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    }
  }

  const connectCta = (
    <Button nativeButton={false} render={<Link href={`/${locale}/connect`} />}>
      <PlugZapIcon />
      {t("apps.connectCta")}
    </Button>
  )

  return (
    <div className="pb-10">
      <SectionHeader micro={t("apps.micro")} title={t("apps.title")} description={t("apps.description")} />

      {q.error ? (
        <ErrorState error={q.error} />
      ) : q.isLoading ? (
        <LoadingRows rows={3} />
      ) : active.length === 0 ? (
        <EmptyState title={t("apps.emptyTitle")} body={t("apps.emptyBody")} action={connectCta} />
      ) : (
        <RowList label={t("apps.title")}>
          {active.map((g) => (
            <GrantRow key={g.id} g={g} onRevoke={revoke} />
          ))}
        </RowList>
      )}

      {revoked.length > 0 ? (
        <Collapsible open={showRevoked} onOpenChange={setShowRevoked} className="mt-6">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-6 py-3 text-sm font-medium text-grid-fg">
            <ChevronDownIcon className={cn("size-4 transition-transform", !showRevoked && "-rotate-90 rtl:rotate-90")} />
            {t("apps.revokedSection", { n: revoked.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <RowList label={t("apps.revokedSection", { n: revoked.length })}>
              {revoked.map((g) => (
                <GrantRow key={g.id} g={g} />
              ))}
            </RowList>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
