"use client"

import { useState } from "react"
import useSWR from "swr"
import { CopyIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react"

import { CodeInput } from "@/components/auth/parts"
import { AccountSection, StatusLine } from "@/components/account/section"
import { CopyField } from "@/components/copy-field"
import { ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { auth, authMessage, type TwoFactorStatus } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"

/**
 * Two-factor for your own account, ported from fadymondy.com-v2: set up an authenticator app, keep
 * the recovery codes, turn it off. The secret is shown only during setup; recovery codes once.
 */
export function TwoFactorSettings() {
  const { t, formatNumber } = useTranslations()
  const status = useSWR<TwoFactorStatus>("/api/me/2fa", () => auth.twoFactor.status(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [setup, setSetup] = useState<{ secret: string; qr: string; otpauth_url: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      setNotice({ ok: false, text: authMessage(err, t) })
    } finally {
      setBusy(false)
    }
  }

  if (status.isLoading) return <LoadingRows rows={2} />
  if (status.error || !status.data) return <ErrorState error={status.error} />

  const s = status.data

  return (
    <>
      <div className="flex items-center gap-2 border-y border-line px-6 py-4 text-sm font-medium">
        {s.enabled ? <ShieldCheckIcon className="size-4 text-grid-fg" /> : <ShieldOffIcon className="size-4 text-grid-muted" />}
        {s.enabled
          ? t("account.security.on", { count: formatNumber(s.recovery_codes_left) })
          : t("account.security.off")}
      </div>

      {codes ? (
        <AccountSection title={t("account.security.codesTitle")} description={t("account.security.codesHelp")}>
          <div className="flex max-w-md flex-col gap-4">
            <ul dir="ltr" className="grid grid-cols-2 gap-1 border border-line bg-grid-card p-4 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(codes.join("\n"))
                  setCopied(true)
                }}
              >
                <CopyIcon />
                {copied ? t("account.security.copied") : t("account.security.copy")}
              </Button>
              <Button
                onClick={() => {
                  setCodes(null)
                  setCopied(false)
                }}
              >
                {t("account.security.savedThem")}
              </Button>
            </div>
          </div>
        </AccountSection>
      ) : null}

      {!s.enabled && !s.available ? (
        <p role="alert" className="border-b border-line px-6 py-4 text-sm text-grid-danger-text">
          {t("account.security.unavailable")}
        </p>
      ) : null}

      {!s.enabled && s.available && !setup ? (
        <div className="flex flex-wrap gap-2 px-6 py-6">
          <Button disabled={busy} onClick={() => void run(async () => setSetup(await auth.twoFactor.enroll()))}>
            <ShieldCheckIcon />
            {busy ? t("common.working") : t("account.security.setUp")}
          </Button>
          <StatusLine notice={notice} />
        </div>
      ) : null}

      {setup && !s.enabled ? (
        <AccountSection title={t("account.security.setupTitle")} description={t("account.security.scan")}>
          <form
            className="max-w-md"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const result = await auth.twoFactor.confirm(code)
                setCodes(result.recovery_codes)
                setSetup(null)
                setCode("")
                await status.mutate()
              })
            }}
          >
            <FieldGroup>
              {setup.qr ? (
                // A data: URL from the server; next/image adds nothing for it.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={setup.qr} alt={t("account.security.qrAlt")} width={200} height={200} className="self-start border border-line bg-white p-2" />
              ) : null}
              <Field>
                <FieldLabel>{t("account.security.manual")}</FieldLabel>
                <CopyField value={setup.secret} />
                <FieldDescription>{t("account.security.manualHelp")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="totp">{t("auth.appCode")}</FieldLabel>
                <CodeInput id="totp" className="max-w-48" value={code} onChange={setCode} />
              </Field>
              <StatusLine notice={notice} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || code.length !== 6}>
                  {busy ? t("common.working") : t("account.security.confirm")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSetup(null)
                    setCode("")
                    setNotice(null)
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </AccountSection>
      ) : null}

      {s.enabled ? (
        <AccountSection title={t("account.security.manageTitle")} description={t("account.security.manageHelp")}>
          <FieldGroup className="max-w-md">
            <Field>
              <FieldLabel htmlFor="totp">{t("auth.appCode")}</FieldLabel>
              <CodeInput id="totp" className="max-w-48" value={code} onChange={setCode} />
            </Field>
            <StatusLine notice={notice} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || code.length !== 6}
                onClick={() =>
                  void run(async () => {
                    const result = await auth.twoFactor.newRecoveryCodes(code)
                    setCodes(result.recovery_codes)
                    setCode("")
                    await status.mutate()
                  })
                }
              >
                {t("account.security.newCodes")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy || code.length !== 6}
                onClick={() =>
                  void run(async () => {
                    await auth.twoFactor.disable({ code })
                    setCode("")
                    setCodes(null)
                    await status.mutate()
                    setNotice({ ok: true, text: t("account.security.turnedOff") })
                  })
                }
              >
                <ShieldOffIcon />
                {t("account.security.turnOff")}
              </Button>
            </div>
          </FieldGroup>
        </AccountSection>
      ) : null}
    </>
  )
}
