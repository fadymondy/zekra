"use client"

import { useMemo, useState, type FormEvent } from "react"
import { PlusIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SectionHeader, SectionTitle } from "@/components/page"
import { ConfirmButton } from "@/components/confirm-button"
import { CopyField, Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { GrantHeader, GrantRow } from "@/components/admin/grants"
import { toastError } from "@/components/admin/toast-error"
import { ApiError, brainApi, type Grant, type Token } from "@/lib/api"
import { useTokens } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useBrains } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

/** The list may carry the full secret or a masked one; only ever show a short prefix. */
const maskToken = (tok: string) => (tok.length > 10 ? `${tok.slice(0, 8)}…` : tok)

export default function AdminTokensPage() {
  const { t, locale, formatNumber } = useTranslations()
  useDocumentTitle(t("nav.tokens"))
  const tokens = useTokens()
  const [creating, setCreating] = useState(false)

  const list = tokens.data ?? []
  const active = list.filter((tok) => !tok.revoked)

  async function revoke(tok: Token) {
    try {
      await brainApi.revokeToken({ token: tok.token })
      toast.success(t("admin.tokens.revoked"))
      await tokens.mutate()
    } catch (err) {
      toastError(err, locale)
    }
  }

  // One grants editor per agent (an agent may hold several tokens; grants belong to the agent).
  const agents = useMemo(() => {
    const m = new Map<string, { agentId: string; isAdmin: boolean; grants: Grant[] }>()
    for (const tok of active) {
      if (!tok.agentId) continue
      const cur = m.get(tok.agentId)
      m.set(tok.agentId, {
        agentId: tok.agentId,
        isAdmin: (cur?.isAdmin ?? false) || tok.isAdmin,
        grants: cur && cur.grants.length ? cur.grants : (tok.grants ?? []),
      })
    }
    return [...m.values()].sort((a, b) => a.agentId.localeCompare(b.agentId))
  }, [active])

  return (
    <>
      <SectionHeader
        micro={t("admin.micro")}
        title={t("nav.tokens")}
        description={t("admin.tokens.hint")}
        action={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("admin.tokens.create")}
          </Button>
        }
      />

      {tokens.error ? (
        <ErrorState error={tokens.error} />
      ) : tokens.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("admin.tokens.empty")} body={t("admin.tokens.emptyBody")} />
      ) : (
        <>
          <div className="border-y border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-6">{t("admin.tokens.agent")}</TableHead>
                  <TableHead>{t("admin.tokens.label")}</TableHead>
                  <TableHead>{t("admin.tokens.token")}</TableHead>
                  <TableHead>{t("admin.tokens.grants")}</TableHead>
                  <TableHead>{t("admin.tokens.lastUsed")}</TableHead>
                  <TableHead className="pe-6 text-end">
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((tok) => (
                  <TokenRow key={tok.token} tok={tok} onRevoke={() => revoke(tok)} />
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="px-6 py-3 text-xs text-grid-muted">
            {t("admin.tokens.summary", { active: formatNumber(active.length), total: formatNumber(list.length) })}
          </p>

          <SectionTitle>{t("admin.tokens.grantsTitle")}</SectionTitle>
          <p className="-mt-1 px-6 pb-4 text-sm text-grid-muted">{t("admin.tokens.grantsHint")}</p>
          {agents.length === 0 ? (
            <EmptyState title={t("admin.tokens.noAgents")} />
          ) : (
            <div className="mb-8 divide-y divide-line border-y border-line">
              {agents.map((a) => (
                <AgentGrants key={a.agentId} agentId={a.agentId} isAdmin={a.isAdmin} grants={a.grants} onChanged={() => tokens.mutate()} />
              ))}
            </div>
          )}
        </>
      )}

      <CreateTokenDialog open={creating} onOpenChange={setCreating} onCreated={() => tokens.mutate()} />
    </>
  )
}

function TokenRow({ tok, onRevoke }: { tok: Token; onRevoke: () => Promise<void> }) {
  const { t, formatDate, formatNumber, timeAgo } = useTranslations()
  const n = tok.grants?.length ?? 0
  return (
    <TableRow className={tok.revoked ? "opacity-60" : undefined}>
      <TableCell className="ps-6">
        <span className="flex items-center gap-2">
          <Ltr mono className="font-medium">{tok.agentId}</Ltr>
          {tok.isAdmin ? <Badge variant="secondary">{t("admin.tokens.admin")}</Badge> : null}
        </span>
      </TableCell>
      <TableCell className="max-w-56 truncate text-grid-muted" dir="auto">
        {tok.label || "—"}
      </TableCell>
      <TableCell>
        <Ltr mono className="text-xs text-grid-muted">{maskToken(tok.token)}</Ltr>
      </TableCell>
      <TableCell className="text-grid-muted">
        {tok.isAdmin ? t("admin.tokens.allBrains") : t("admin.tokens.grantCount", { n: formatNumber(n) })}
      </TableCell>
      <TableCell className="text-grid-muted">
        {tok.lastUsedAt ? (
          <span title={formatDate(tok.lastUsedAt, { dateStyle: "medium", timeStyle: "short" })}>{timeAgo(tok.lastUsedAt)}</span>
        ) : (
          t("common.never")
        )}
      </TableCell>
      <TableCell className="pe-6 text-end">
        {tok.revoked ? (
          <Badge variant="secondary">{t("admin.tokens.revokedBadge")}</Badge>
        ) : (
          <ConfirmButton
            label={t("common.revoke")}
            title={t("admin.tokens.revokeTitle")}
            description={t("admin.tokens.revokeBody", { agent: tok.agentId })}
            confirmLabel={t("common.revoke")}
            onConfirm={onRevoke}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

/** One agent's grants across brains: toggle read/write, revoke, or grant a new brain. */
function AgentGrants({ agentId, isAdmin, grants, onChanged }: { agentId: string; isAdmin: boolean; grants: Grant[]; onChanged: () => void }) {
  const { t, locale } = useTranslations()
  const brains = useBrains()
  const [busy, setBusy] = useState(false)
  const [addNs, setAddNs] = useState("")

  const granted = new Set(grants.map((g) => g.namespace))
  const available = (brains.data ?? []).filter((b) => !granted.has(b.namespace))
  const brainItems = available.map((b) => ({ value: b.namespace, label: b.namespace }))

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      onChanged()
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
    }
  }

  const upsert = (namespace: string, v: { canRead: boolean; canWrite: boolean }) =>
    run(() => (!v.canRead && !v.canWrite ? brainApi.revokeGrant({ agentId, namespace }) : brainApi.grant({ agentId, namespace, ...v })))

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4 pb-2">
        <Ltr mono className="text-sm font-medium text-grid-fg">{agentId}</Ltr>
        {isAdmin ? (
          <>
            <Badge variant="secondary">{t("admin.tokens.admin")}</Badge>
            <span className="text-xs text-grid-muted">{t("permissions.adminHint")}</span>
          </>
        ) : null}
      </div>
      <GrantHeader subject={t("admin.tokens.brain")} />
      {grants.length === 0 ? (
        <p className="px-6 py-3 text-xs text-grid-muted">{t("admin.tokens.noGrants")}</p>
      ) : (
        <div className="divide-y divide-line">
          {grants.map((g) => (
            <GrantRow
              key={g.namespace}
              label={g.namespace}
              name={<Ltr mono className="truncate text-grid-fg">{g.namespace}</Ltr>}
              canRead={g.canRead}
              canWrite={g.canWrite}
              disabled={busy}
              onChange={(v) => upsert(g.namespace, v)}
              onRevoke={() => run(() => brainApi.revokeGrant({ agentId, namespace: g.namespace }))}
            />
          ))}
        </div>
      )}
      {brainItems.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3">
          <Select items={brainItems} value={addNs || null} onValueChange={(v) => setAddNs(String(v ?? ""))}>
            <SelectTrigger aria-label={t("admin.tokens.addBrain")} className="w-full sm:w-64">
              <SelectValue placeholder={t("admin.tokens.addBrain")} />
            </SelectTrigger>
            <SelectContent>
              {brainItems.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  <Ltr mono>{b.label}</Ltr>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!addNs || busy}
            onClick={() => {
              const ns = addNs
              setAddNs("")
              void upsert(ns, { canRead: true, canWrite: false })
            }}
          >
            <PlusIcon />
            {t("admin.tokens.grantRead")}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function CreateTokenDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const { t } = useTranslations()
  const [agentId, setAgentId] = useState("")
  const [label, setLabel] = useState("")
  const [admin, setAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Token | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setAgentId("")
      setLabel("")
      setAdmin(false)
      setError(null)
      setCreated(null)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const tok = await brainApi.createToken({ agentId: agentId.trim(), label: label.trim(), isAdmin: admin })
      setCreated(tok)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("admin.tokens.createdTitle")}</DialogTitle>
              <DialogDescription>
                {t("admin.tokens.createdHint")} <Ltr mono className="text-grid-fg">{created.agentId}</Ltr>
              </DialogDescription>
            </DialogHeader>
            <p className="flex items-start gap-2 border border-line bg-grid-card p-3 text-sm text-grid-warn-text" role="alert">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {t("admin.tokens.shownOnce")}
            </p>
            <div className="space-y-1.5">
              <p className="grid-micro">{t("admin.tokens.token")}</p>
              <CopyField value={created.token} label={t("admin.tokens.token")} />
            </div>
            <div className="space-y-1.5">
              <p className="grid-micro">{t("admin.tokens.envLabel")}</p>
              <CopyField value={`ZEKRA_TOKEN=${created.token}`} label={t("admin.tokens.envLabel")} />
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{t("admin.tokens.savedIt")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("admin.tokens.create")}</DialogTitle>
              <DialogDescription>{t("admin.tokens.createHint")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tok-agent">{t("admin.tokens.agent")}</FieldLabel>
                <Input id="tok-agent" dir="ltr" required autoFocus value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="alice" className="font-mono" />
                <FieldDescription>{t("admin.tokens.agentHint")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="tok-label">{t("admin.tokens.label")}</FieldLabel>
                <Input id="tok-label" dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("admin.tokens.labelPlaceholder")} />
              </Field>
              <Field orientation="horizontal">
                <Switch id="tok-admin" checked={admin} onCheckedChange={(v) => setAdmin(v === true)} />
                <FieldContent>
                  <FieldLabel htmlFor="tok-admin">{t("admin.tokens.adminLabel")}</FieldLabel>
                  <FieldDescription>{t("admin.tokens.adminHint")}</FieldDescription>
                </FieldContent>
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !agentId.trim()}>
                {busy ? t("common.working") : t("admin.tokens.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
