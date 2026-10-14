"use client"

import { Button, Field, FieldLabel, Input } from "@fadymondy/nasaq/web"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { CheckIcon } from "lucide-react"

import { useProfile } from "@/components/account/profile"
import { AccountSection, StatusLine } from "@/components/account/section"
import { cancelDeletion, requestCancelCode, requestDeletion, requestDeletionCode, type DeletionProof } from "@/lib/account"
import { authMessage } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"

/*
  Delete my account, ported from fadymondy.com-v2. A session alone never deletes an account: it is
  confirmed with the password, or with a 6-digit code mailed to the account's address — the only
  way for an account made by Google / Apple / GitHub, which has no password. Deletion is scheduled,
  not immediate: the session is revoked at once, and the cancel leg (public: email + password, or
  email + an emailed code) works until the grace period ends.
*/

const WHAT = ["signedOut", "grace", "profile", "connections", "tokens", "audit"] as const

type ProofMode = "password" | "code"

/** A 6-digit code field: one-time-code autofill, Latin digits, LTR in both languages. */
function CodeInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      dir="ltr"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      required
      className="font-mono tracking-widest"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
    />
  )
}

export function DeleteAccount() {
  const { t, locale, formatDate } = useTranslations()
  const me = useMe()
  const profile = useProfile()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  // Passwordless accounts can only use the emailed code.
  const hasPassword = profile.data?.has_password !== false
  const [chosen, setChosen] = useState<ProofMode>("password")
  const mode: ProofMode = hasPassword ? chosen : "code"
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduledFor, setScheduledFor] = useState<string | null>(null)
  // Captured before the session ends so the cancel form can prefill it.
  const [email, setEmail] = useState("")

  async function sendCode() {
    setSending(true)
    setError(null)
    try {
      await requestDeletionCode(locale)
      setCodeSent(true)
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setSending(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setEmail(me.data?.email ?? "")
      const proof: DeletionProof = mode === "code" ? { code } : { password }
      const result = await requestDeletion(proof)
      setScheduledFor(result?.scheduled_for ?? "")
      setPassword("")
      setCode("")
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  const proofReady = mode === "code" ? code.length === 6 : !!password

  return (
    <>
      <AccountSection title={t("account.delete.whatTitle")}>
        <ul className="flex max-w-2xl flex-col gap-2 text-sm text-pretty text-nq-fg-body">
          {WHAT.map((key) => (
            <li key={key} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 bg-nq-danger" />
              {t(`account.delete.what.${key}`)}
            </li>
          ))}
        </ul>
      </AccountSection>

      {scheduledFor !== null ? (
        <>
          <div className="flex items-start gap-2 border-b border-border px-6 py-4 text-sm text-pretty text-foreground" role="status">
            <CheckIcon className="mt-0.5 size-4 shrink-0" />
            {scheduledFor
              ? t("account.delete.scheduled", { date: formatDate(scheduledFor, { dateStyle: "long" }) })
              : t("account.delete.scheduledNoDate")}
          </div>
          <CancelForm initialEmail={email} />
          <div className="flex flex-wrap gap-2 px-6 py-6">
            <Button
              variant="secondary"
              onClick={async () => {
                await mutate("/api/auth/me", null, { revalidate: false })
                router.replace("/")
              }}
            >
              {t("account.delete.leave")}
            </Button>
          </div>
        </>
      ) : (
        <AccountSection
          title={t("account.delete.formTitle")}
          description={hasPassword ? t("account.delete.formHint") : t("account.delete.formHintNoPassword")}
        >
          <form onSubmit={submit} className="max-w-md">
            <div className="grid gap-4">
              {me.data?.email ? (
                <p className="text-xs text-muted-foreground">
                  {t("account.delete.signedInAs")}{" "}
                  <bdi dir="ltr" className="font-mono">
                    {me.data.email}
                  </bdi>
                </p>
              ) : null}
              {mode === "password" ? (
                <Field>
                  <FieldLabel htmlFor="delete-password">{t("account.delete.password")}</FieldLabel>
                  <Input
                    id="delete-password"
                    type="password"
                    dir="ltr"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              ) : (
                <div className="grid gap-3">
                  <p className="text-sm text-pretty text-nq-fg-body">
                    {codeSent ? t("account.delete.codeSent") : t("account.delete.codeHint")}
                  </p>
                  <Button type="button" variant="secondary" className="self-start" disabled={sending} onClick={() => void sendCode()}>
                    {sending ? t("common.working") : codeSent ? t("account.delete.resendCode") : t("account.delete.sendCode")}
                  </Button>
                  {codeSent ? (
                    <Field>
                      <FieldLabel htmlFor="delete-code">{t("account.delete.code")}</FieldLabel>
                      <CodeInput id="delete-code" value={code} onChange={setCode} />
                    </Field>
                  ) : null}
                </div>
              )}
              {hasPassword ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setChosen(mode === "password" ? "code" : "password")
                    setError(null)
                  }}
                >
                  {mode === "password" ? t("account.delete.useCode") : t("account.delete.usePassword")}
                </Button>
              ) : null}
              <label className="flex items-start gap-2 text-sm text-pretty text-nq-fg-body">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 accent-(--destructive)"
                />
                {t("account.delete.confirm")}
              </label>
              <StatusLine notice={error ? { ok: false, text: error } : null} />
              <Button type="submit" variant="danger" className="self-start" disabled={!confirmed || !proofReady || busy}>
                {busy ? t("common.working") : t("account.delete.submit")}
              </Button>
            </div>
          </form>
        </AccountSection>
      )}
    </>
  )
}

/** The public cancel leg: the account is signed out by then, so it proves itself with its password
 *  or a code mailed to the address (the only way for an account without a password). */
export function CancelForm({ initialEmail = "" }: { initialEmail?: string }) {
  const { t, locale } = useTranslations()
  const [email, setEmail] = useState(initialEmail)
  const [mode, setMode] = useState<ProofMode>("code")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function sendCode() {
    setSending(true)
    setError(null)
    try {
      await requestCancelCode(email.trim(), locale)
      setCodeSent(true)
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setSending(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await cancelDeletion(email.trim(), mode === "code" ? { code } : { password })
      setDone(true)
      setPassword("")
      setCode("")
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  const proofReady = mode === "code" ? code.length === 6 : !!password

  return (
    <AccountSection title={t("account.delete.cancelTitle")} description={t("account.delete.cancelHint")}>
      {done ? (
        <p role="status" className="flex items-start gap-2 text-sm text-pretty text-foreground">
          <CheckIcon className="mt-0.5 size-4 shrink-0" />
          {t("account.delete.cancelled")}
        </p>
      ) : (
        <form onSubmit={submit} className="max-w-md">
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="cancel-email">{t("auth.email")}</FieldLabel>
              <Input id="cancel-email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {mode === "password" ? (
              <Field>
                <FieldLabel htmlFor="cancel-password">{t("account.delete.password")}</FieldLabel>
                <Input id="cancel-password" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm text-pretty text-nq-fg-body">
                  {codeSent ? t("account.delete.cancelCodeSent") : t("account.delete.cancelCodeHint")}
                </p>
                <Button type="button" variant="secondary" className="self-start" disabled={sending || !email.includes("@")} onClick={() => void sendCode()}>
                  {sending ? t("common.working") : codeSent ? t("account.delete.resendCode") : t("account.delete.sendCode")}
                </Button>
                {codeSent ? (
                  <Field>
                    <FieldLabel htmlFor="cancel-code">{t("account.delete.code")}</FieldLabel>
                    <CodeInput id="cancel-code" value={code} onChange={setCode} />
                  </Field>
                ) : null}
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                setMode(mode === "password" ? "code" : "password")
                setError(null)
              }}
            >
              {mode === "password" ? t("account.delete.useCode") : t("account.delete.usePassword")}
            </Button>
            <StatusLine notice={error ? { ok: false, text: error } : null} />
            <Button type="submit" variant="secondary" className="self-start" disabled={!email || !proofReady || busy}>
              {busy ? t("common.working") : t("account.delete.cancelSubmit")}
            </Button>
          </div>
        </form>
      )}
    </AccountSection>
  )
}
