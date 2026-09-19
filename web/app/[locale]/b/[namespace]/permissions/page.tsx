"use client"

import { useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SectionHeader, SectionTitle } from "@/components/page"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { GrantHeader, GrantRow } from "@/components/admin/grants"
import { toastError } from "@/components/admin/toast-error"
import { brainApi } from "@/lib/api"
import { agentsForBrain, useTokens } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { isAdmin, useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

export default function PermissionsPage() {
  const { namespace: raw } = useParams<{ namespace: string }>()
  const ns = decodeURIComponent(raw)
  const { t, locale, formatNumber } = useTranslations()
  useDocumentTitle(`${t("nav.permissions")} · ${ns}`)
  const me = useMe()
  const tokens = useTokens()
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => agentsForBrain(tokens.data ?? [], ns), [tokens.data, ns])
  const granted = rows.filter((r) => r.grant && !r.isAdmin)
  const admins = rows.filter((r) => r.isAdmin)
  const ungranted = rows.filter((r) => !r.grant && !r.isAdmin)

  async function upsert(agentId: string, v: { canRead: boolean; canWrite: boolean }) {
    setBusy(true)
    try {
      if (!v.canRead && !v.canWrite) await brainApi.revokeGrant({ agentId, namespace: ns })
      else await brainApi.grant({ agentId, namespace: ns, ...v })
      await tokens.mutate()
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(agentId: string) {
    setBusy(true)
    try {
      await brainApi.revokeGrant({ agentId, namespace: ns })
      toast.success(t("permissions.revoked", { agent: agentId }))
      await tokens.mutate()
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeader
        micro={<Ltr>{ns}</Ltr>}
        title={t("nav.permissions")}
        description={t("permissions.hint")}
        action={
          isAdmin(me.data) ? (
            <Button variant="outline" nativeButton={false} render={<Link href={`/${locale}/admin/tokens`} />}>
              {t("permissions.manageTokens")}
            </Button>
          ) : null
        }
      />

      {tokens.error ? (
        <ErrorState error={tokens.error} />
      ) : tokens.isLoading ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState title={t("permissions.noAgents")} body={t("permissions.noAgentsBody")} />
      ) : (
        <>
          <AddGrant agents={ungranted.map((r) => r.agentId)} disabled={busy} onAdd={upsert} />

          <SectionTitle>
            {t("permissions.agents")}{" "}
            <span className="text-sm font-normal text-grid-muted">{formatNumber(granted.length)}</span>
          </SectionTitle>
          {granted.length === 0 ? (
            <EmptyState title={t("permissions.noGrants")} body={t("permissions.noGrantsBody")} />
          ) : (
            <div className="border-y border-line">
              <GrantHeader subject={t("permissions.agent")} />
              <div className="divide-y divide-line">
                {granted.map((r) => (
                  <GrantRow
                    key={r.agentId}
                    label={r.agentId}
                    name={<Ltr mono className="truncate font-medium text-grid-fg">{r.agentId}</Ltr>}
                    canRead={r.grant?.canRead ?? false}
                    canWrite={r.grant?.canWrite ?? false}
                    disabled={busy}
                    onChange={(v) => upsert(r.agentId, v)}
                    onRevoke={() => revoke(r.agentId)}
                  />
                ))}
              </div>
            </div>
          )}

          {admins.length > 0 ? (
            <>
              <SectionTitle>{t("permissions.admins")}</SectionTitle>
              <ul className="divide-y divide-line border-y border-line">
                {admins.map((r) => (
                  <li key={r.agentId} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                    <Ltr mono className="font-medium text-grid-fg">{r.agentId}</Ltr>
                    <Badge variant="secondary">{t("permissions.admin")}</Badge>
                    <span className="ms-auto text-xs text-grid-muted">{t("permissions.adminHint")}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </>
  )
}

const LEVELS = ["read", "write"] as const

function AddGrant({
  agents,
  disabled,
  onAdd,
}: {
  agents: string[]
  disabled: boolean
  onAdd: (agentId: string, v: { canRead: boolean; canWrite: boolean }) => Promise<void>
}) {
  const { t } = useTranslations()
  const [agent, setAgent] = useState("")
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("read")

  const agentItems = agents.map((a) => ({ value: a, label: a }))
  const levelItems = LEVELS.map((l) => ({ value: l, label: t(`permissions.level.${l}`) }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!agent) return
    await onAdd(agent, { canRead: true, canWrite: level === "write" })
    setAgent("")
  }

  return (
    <section className="border-t border-line px-6 py-6">
      <h2 className="text-base font-medium">{t("permissions.addTitle")}</h2>
      <p className="mt-1 mb-5 text-sm text-grid-muted">{t("permissions.addHint")}</p>
      {agents.length === 0 ? (
        <p className="text-sm text-grid-muted">{t("permissions.allGranted")}</p>
      ) : (
        <form onSubmit={onSubmit}>
          <FieldGroup className="sm:flex-row sm:items-end">
            <Field className="sm:flex-1">
              <FieldLabel htmlFor="grant-agent">{t("permissions.agent")}</FieldLabel>
              <Select items={agentItems} value={agent || null} onValueChange={(v) => setAgent(String(v ?? ""))}>
                <SelectTrigger id="grant-agent" className="w-full">
                  <SelectValue placeholder={t("permissions.pickAgent")} />
                </SelectTrigger>
                <SelectContent>
                  {agentItems.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      <Ltr mono>{a.label}</Ltr>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="sm:w-44">
              <FieldLabel htmlFor="grant-level">{t("permissions.access")}</FieldLabel>
              <Select items={levelItems} value={level} onValueChange={(v) => setLevel(v === "write" ? "write" : "read")}>
                <SelectTrigger id="grant-level" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {levelItems.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" disabled={disabled || !agent}>
              {t("permissions.grant")}
            </Button>
          </FieldGroup>
        </form>
      )}
    </section>
  )
}
