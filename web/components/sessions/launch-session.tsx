"use client"

import { useState } from "react"
import { RocketIcon } from "lucide-react"

import { CopyField } from "@/components/copy-field"
import { CodeBlock } from "@/components/ui/code-block"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ApiError, brainApi, type SessionResult } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

/** Mint a scoped session token for a brain. */
export function useLaunchSession(namespace: string) {
  const { t } = useTranslations()
  const [write, setWrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  async function launch() {
    setBusy(true)
    setError(null)
    try {
      setResult(await brainApi.launchSession({ namespace, write, label: `console session for ${namespace}` }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }
  return { write, setWrite, busy, error, result, launch, reset: () => setResult(null) }
}

export function WriteToggle({ write, onChange }: { write: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslations()
  return (
    <div className="flex items-center justify-between gap-4 border border-line bg-grid-card px-4 py-3">
      <div className="space-y-0.5">
        <Label htmlFor="launch-write" className="text-sm font-medium">
          {t("sessions.allowWrites")}
        </Label>
        <p className="text-xs text-grid-muted">{t(write ? "sessions.writeHint" : "sessions.readHint")}</p>
      </div>
      <Switch id="launch-write" checked={write} onCheckedChange={onChange} />
    </div>
  )
}

/** The minted session: scope, the one-time token, the .mcp.json snippet, and how to use it. */
export function SessionResultView({ res }: { res: SessionResult }) {
  const { t } = useTranslations()
  const snippet = JSON.stringify(res.mcpConfig, null, 2)
  const steps = ["sessions.step1", "sessions.step2", "sessions.step3"]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" dir="ltr" className="font-mono">
          {res.namespace}
        </Badge>
        <Badge variant={res.write ? "default" : "secondary"}>{t(res.write ? "sessions.readWrite" : "sessions.readOnly")}</Badge>
        <span className="text-xs text-grid-muted">
          {t("sessions.agent")} <span dir="ltr" className="font-mono">{res.agentId}</span>
        </span>
      </div>

      <div className="space-y-1.5">
        <p className="grid-micro">{t("sessions.token")}</p>
        <CopyField value={res.token} label={t("sessions.token")} />
        <p className="text-xs text-grid-warn">{t("sessions.tokenOnce")}</p>
      </div>

      <div className="space-y-1.5">
        <p className="grid-micro">{t("sessions.mcpConfig")}</p>
        <div dir="ltr">
          <CodeBlock code={snippet} language="json" filename=".mcp.json" scrollable maxHeight={280} className="rounded-none border-line" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="grid-micro">{t("sessions.howTo")}</p>
        <ol className="list-decimal space-y-1 ps-5 text-sm text-grid-body">
          {steps.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
        {res.howto ? (
          <p dir="auto" className="text-xs whitespace-pre-wrap text-grid-muted">
            {res.howto}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Launch-session as a dialog, e.g. from a brain card on the Brains hub. */
export function LaunchSessionDialog({ namespace, open, onOpenChange }: { namespace: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslations()
  const s = useLaunchSession(namespace)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setTimeout(s.reset, 200)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("sessions.launch")}</DialogTitle>
          <DialogDescription>
            {t("sessions.launchHint")}{" "}
            <span dir="ltr" className="font-mono text-grid-fg">
              {namespace}
            </span>
          </DialogDescription>
        </DialogHeader>
        {s.result ? (
          <SessionResultView res={s.result} />
        ) : (
          <>
            <WriteToggle write={s.write} onChange={s.setWrite} />
            {s.error ? (
              <p role="alert" className="text-sm text-grid-danger-text">
                {s.error}
              </p>
            ) : null}
          </>
        )}
        <DialogFooter>
          {s.result ? (
            <Button onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={s.launch} disabled={s.busy}>
                <RocketIcon /> {s.busy ? t("sessions.minting") : t("sessions.mint")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
