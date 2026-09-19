"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useParams } from "next/navigation"
import { EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SectionHeader } from "@/components/page"
import { ConfirmButton } from "@/components/confirm-button"
import { CopyField, Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { toastError } from "@/components/admin/toast-error"
import { ApiError, brainApi, type SecretMeta } from "@/lib/api"
import { useSecrets } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

// The kinds the backend recognises (auto-capture + manual). `generic` is the default.
const KINDS = ["generic", "api_key", "password", "token", "env", "private_key", "connection_string", "credential"] as const

export default function SecretsPage() {
  const { namespace: raw } = useParams<{ namespace: string }>()
  const ns = decodeURIComponent(raw)
  const { t, formatNumber } = useTranslations()
  useDocumentTitle(`${t("nav.secrets")} · ${ns}`)
  const secrets = useSecrets(ns)
  const [editing, setEditing] = useState<{ name: string; kind: string } | null>(null)
  const [filter, setFilter] = useState("")

  const list = secrets.data ?? []
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return f ? list.filter((s) => s.name.toLowerCase().includes(f) || (s.kind ?? "").toLowerCase().includes(f)) : list
  }, [list, filter])

  return (
    <>
      <SectionHeader
        micro={<Ltr>{ns}</Ltr>}
        title={t("nav.secrets")}
        description={t("secrets.hint")}
        action={
          <Button onClick={() => setEditing({ name: "", kind: "generic" })}>
            <PlusIcon />
            {t("secrets.add")}
          </Button>
        }
      />

      {list.length > 5 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
            <Input
              aria-label={t("secrets.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("secrets.filterPlaceholder")}
              className="ps-8"
            />
          </div>
          <span className="ms-auto text-xs text-grid-muted">
            {filter
              ? t("secrets.countFiltered", { n: formatNumber(visible.length), total: formatNumber(list.length) })
              : t("secrets.count", { n: formatNumber(list.length) })}
          </span>
        </div>
      ) : null}

      {secrets.error ? (
        <ErrorState error={secrets.error} />
      ) : secrets.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("secrets.empty")} body={t("secrets.emptyBody")} />
      ) : visible.length === 0 ? (
        <EmptyState title={t("secrets.noMatch")} />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {visible.map((s) => (
            <SecretRow key={s.name} s={s} onUpdate={() => setEditing({ name: s.name, kind: s.kind || "generic" })} onDeleted={() => secrets.mutate()} />
          ))}
        </ul>
      )}

      <SecretDialog
        namespace={ns}
        initial={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => secrets.mutate()}
      />
    </>
  )
}

/** One secret. The value is never preloaded: it is fetched only on Reveal (which needs write access). */
function SecretRow({ s, onUpdate, onDeleted }: { s: SecretMeta; onUpdate: () => void; onDeleted: () => void }) {
  const { t, locale, formatDate, timeAgo } = useTranslations()
  const [value, setValue] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [denied, setDenied] = useState<string | null>(null)

  async function reveal() {
    setRevealing(true)
    setDenied(null)
    try {
      const r = await brainApi.revealSecret({ namespace: s.namespace, name: s.name })
      setValue(r.value)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setDenied(t("secrets.revealDenied"))
      else toastError(err, locale)
    } finally {
      setRevealing(false)
    }
  }

  async function remove() {
    try {
      await brainApi.deleteSecret({ namespace: s.namespace, name: s.name })
      toast.success(t("secrets.deleted"))
      onDeleted()
    } catch (err) {
      toastError(err, locale)
    }
  }

  return (
    <li className="space-y-2 px-6 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Ltr mono className="truncate font-medium text-grid-fg">{s.name}</Ltr>
        <Badge variant="outline">{(KINDS as readonly string[]).includes(s.kind || "generic") ? t(`secrets.kind.${s.kind || "generic"}`) : <Ltr>{s.kind}</Ltr>}</Badge>
        {value === null ? (
          <Ltr mono className="border border-line bg-grid-card px-2 py-0.5 text-xs text-grid-muted">{s.hint || "•••"}</Ltr>
        ) : null}
        <span className="ms-auto flex flex-wrap gap-x-3 text-xs text-grid-muted">
          {s.createdBy ? (
            <span>
              {t("secrets.by")} <Ltr>{s.createdBy}</Ltr>
            </span>
          ) : null}
          <span title={formatDate(s.updatedAt, { dateStyle: "medium", timeStyle: "short" })}>
            {t("secrets.updated", { when: timeAgo(s.updatedAt) })}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {value === null ? (
            <Button variant="outline" size="sm" onClick={reveal} disabled={revealing}>
              <EyeIcon />
              {revealing ? t("secrets.revealing") : t("secrets.reveal")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setValue(null)}>
              <EyeOffIcon />
              {t("secrets.hide")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onUpdate}>
            <PencilIcon />
            {t("secrets.update")}
          </Button>
          <ConfirmButton
            label={t("common.delete")}
            title={t("secrets.deleteTitle")}
            description={t("secrets.deleteBody", { name: s.name })}
            confirmLabel={t("common.delete")}
            onConfirm={remove}
          />
        </div>
      </div>
      {value !== null ? <CopyField value={value} label={s.name} /> : null}
      {s.sourceRef ? (
        <p className="text-xs text-grid-muted">
          {t("secrets.source")} <Ltr mono>{s.sourceRef}</Ltr>
        </p>
      ) : null}
      {denied ? <p className="text-xs text-grid-warn-text" role="alert">{denied}</p> : null}
    </li>
  )
}

/** Add a secret, or replace the value of an existing one (same name upserts). */
function SecretDialog({
  namespace,
  initial,
  onOpenChange,
  onSaved,
}: {
  namespace: string
  initial: { name: string; kind: string } | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const open = initial !== null
  const updating = !!initial?.name
  const { t } = useTranslations()
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [kind, setKind] = useState("generic")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seed, setSeed] = useState<typeof initial>(null)

  // Reset the form whenever the dialog opens for a different secret.
  if (initial !== seed) {
    setSeed(initial)
    if (initial) {
      setName(initial.name)
      setKind(initial.kind)
      setValue("")
      setError(null)
    }
  }

  const kindItems = KINDS.map((k) => ({ value: k, label: t(`secrets.kind.${k}`) }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await brainApi.putSecret({ namespace, name: name.trim(), value, kind })
      toast.success(updating ? t("secrets.updatedToast") : t("secrets.added"))
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{updating ? t("secrets.updateTitle") : t("secrets.add")}</DialogTitle>
            <DialogDescription>
              {t("secrets.storedIn")} <Ltr mono>{namespace}</Ltr>
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="secret-name">{t("secrets.name")}</FieldLabel>
              <Input
                id="secret-name"
                dir="ltr"
                required
                autoFocus={!updating}
                readOnly={updating}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="OPENAI_API_KEY"
                className="font-mono"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="secret-value">{t("secrets.value")}</FieldLabel>
              <Textarea
                id="secret-value"
                dir="ltr"
                required
                autoFocus={updating}
                rows={3}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk-…"
                className="resize-y font-mono text-xs"
              />
              {updating ? <FieldDescription>{t("secrets.replaceHint")}</FieldDescription> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="secret-kind">{t("secrets.kindLabel")}</FieldLabel>
              <Select items={kindItems} value={kind} onValueChange={(v) => setKind(String(v ?? "generic"))}>
                <SelectTrigger id="secret-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindItems.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !value}>
              {busy ? t("common.saving") : t("secrets.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
