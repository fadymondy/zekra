"use client"

import { useState } from "react"
import { CheckIcon } from "lucide-react"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldDescription, FieldLabel, Input, Textarea, toast } from "@fadymondy/nasaq/web"

import { PushEndpoint } from "@/components/sources/push-endpoint"
import { KINDS, KIND_BY } from "@/components/sources/kinds"
import { ApiError, brainApi, type Datasource } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Add a source: pick a kind, fill its config form. A webhook reveals its push URL + secret once. */
export function AddSourceDialog({
  namespace,
  open,
  onOpenChange,
  onCreated,
}: {
  namespace: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslations()
  const [kind, setKind] = useState("webhook")
  const [name, setName] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Datasource | null>(null)

  const spec = KIND_BY[kind]
  const missing = spec.fields.some((f) => !f.optional && !values[f.key]?.trim())
  const canSubmit = !!name.trim() && !missing && !busy
  const ph = (p: string) => (p.startsWith("sources.") ? t(p) : p)

  function reset() {
    setKind("webhook")
    setName("")
    setValues({})
    setError(null)
    setCreated(null)
  }
  function close(o: boolean) {
    onOpenChange(o)
    if (!o) setTimeout(reset, 200)
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const config: Record<string, unknown> = {}
    for (const f of spec.fields) {
      const v = values[f.key]?.trim()
      if (v) config[f.key] = f.number && !Number.isNaN(Number(v)) ? Number(v) : v
    }
    try {
      const res = await brainApi.createDatasource({ namespace, kind, name: name.trim(), config })
      onCreated()
      toast.success(t("sources.created"))
      if (res.kind === "webhook") setCreated(res)
      else close(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckIcon className="size-4 text-nq-success" /> {t("sources.webhookReady")}
              </DialogTitle>
              <DialogDescription>{t("sources.webhookReadyHint")}</DialogDescription>
            </DialogHeader>
            <PushEndpoint id={created.id} secret={created.config?.secret} />
            <DialogFooter>
              <Button variant="primary" onClick={() => close(false)}>{t("common.done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("sources.addTitle")}</DialogTitle>
              <DialogDescription>
                {t("sources.addHint")}{" "}
                <span dir="ltr" className="font-mono text-foreground">
                  {namespace}
                </span>
              </DialogDescription>
            </DialogHeader>

            <div role="radiogroup" aria-label={t("sources.kind")} className="grid grid-cols-3 gap-px border border-border bg-border sm:grid-cols-5">
              {KINDS.map((k) => {
                const Icon = k.icon
                const active = k.kind === kind
                return (
                  <button
                    key={k.kind}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={k.soon}
                    title={k.soon ? t("sources.soon") : t(`sources.blurb.${k.kind}`)}
                    onClick={() => {
                      setKind(k.kind)
                      setValues({})
                    }}
                    className={cn(
                      "relative flex flex-col items-center gap-1.5 px-2 py-3 text-xs transition-colors",
                      k.soon
                        ? "cursor-not-allowed bg-card text-muted-foreground/50"
                        : active
                          ? "bg-nq-surface-soft text-foreground"
                          : "bg-card text-muted-foreground hover:bg-nq-surface-soft hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4", active && "text-nq-action")} />
                    <span className="max-w-full truncate">{t(`sources.kind.${k.kind}`)}</span>
                    {active ? <span aria-hidden className="absolute end-1.5 top-1.5 size-1.5 bg-nq-action" /> : null}
                    {k.soon ? <span className="absolute end-1 top-1 text-[12px] leading-none">{t("sources.soon")}</span> : null}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t(`sources.blurb.${kind}`)}</p>

            <Field>
              <FieldLabel htmlFor="src-name">{t("sources.field.name")}</FieldLabel>
              <Input id="src-name" dir="auto" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sources.ph.name")} />
            </Field>
            {spec.fields.map((f) => (
              <Field key={f.key}>
                <FieldLabel htmlFor={`src-${f.key}`}>
                  {t(f.label)}
                  {f.optional ? <span className="font-normal text-muted-foreground">({t("common.optional")})</span> : null}
                </FieldLabel>
                {f.textarea ? (
                  <Textarea
                    id={`src-${f.key}`}
                    dir={f.key === "content" ? "auto" : "ltr"}
                    rows={f.key === "content" ? 6 : 4}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={ph(f.placeholder)}
                    className={cn("resize-y", f.key !== "content" && "font-mono text-xs")}
                  />
                ) : (
                  <Input
                    id={`src-${f.key}`}
                    dir={f.key === "title" ? "auto" : "ltr"}
                    type={f.secret ? "password" : f.number ? "number" : "text"}
                    autoComplete="off"
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={ph(f.placeholder)}
                  />
                )}
                {f.secret ? <FieldDescription>{t("sources.secretNote")}</FieldDescription> : null}
              </Field>
            ))}
            {kind === "webhook" ? <p className="border border-border bg-nq-surface-soft px-3 py-2 text-xs text-nq-fg-body">{t("sources.webhookNote")}</p> : null}
            {error ? (
              <p role="alert" className="text-sm text-nq-danger-text">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" type="submit" disabled={!canSubmit}>
                {busy ? t("sources.connecting") : t("sources.add")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
