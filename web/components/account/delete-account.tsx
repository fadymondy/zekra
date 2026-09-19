"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { CheckIcon } from "lucide-react"

import { AccountSection, StatusLine } from "@/components/account/section"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cancelDeletion, requestDeletion } from "@/lib/account"
import { authMessage } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"

/*
  Delete my account, ported from fadymondy.com-v2. Asking again for the password means a stolen
  session alone cannot delete an account. Deletion is scheduled, not immediate: the session is
  revoked at once, and the cancel leg (public, email + password) works until the grace period ends.
*/

const WHAT = ["signedOut", "grace", "profile", "connections", "tokens", "audit"] as const

export function DeleteAccount() {
  const { t, formatDate } = useTranslations()
  const me = useMe()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const [password, setPassword] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduledFor, setScheduledFor] = useState<string | null>(null)
  // Captured before the session ends so the cancel form can prefill it.
  const [email, setEmail] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setEmail(me.data?.email ?? "")
      const result = await requestDeletion(password)
      setScheduledFor(result?.scheduled_for ?? "")
      setPassword("")
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AccountSection title={t("account.delete.whatTitle")}>
        <ul className="flex max-w-2xl flex-col gap-2 text-sm text-pretty text-grid-body">
          {WHAT.map((key) => (
            <li key={key} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 bg-grid-danger" />
              {t(`account.delete.what.${key}`)}
            </li>
          ))}
        </ul>
      </AccountSection>

      {scheduledFor !== null ? (
        <>
          <div className="flex items-start gap-2 border-b border-line px-6 py-4 text-sm text-pretty text-grid-fg" role="status">
            <CheckIcon className="mt-0.5 size-4 shrink-0" />
            {scheduledFor
              ? t("account.delete.scheduled", { date: formatDate(scheduledFor, { dateStyle: "long" }) })
              : t("account.delete.scheduledNoDate")}
          </div>
          <CancelForm initialEmail={email} />
          <div className="flex flex-wrap gap-2 px-6 py-6">
            <Button
              variant="outline"
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
        <AccountSection title={t("account.delete.formTitle")} description={t("account.delete.formHint")}>
          <form onSubmit={submit} className="max-w-md">
            <FieldGroup>
              {me.data?.email ? (
                <p className="text-xs text-grid-muted">
                  {t("account.delete.signedInAs")}{" "}
                  <bdi dir="ltr" className="font-mono">
                    {me.data.email}
                  </bdi>
                </p>
              ) : null}
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
              <label className="flex items-start gap-2 text-sm text-pretty text-grid-body">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 accent-(--destructive)"
                />
                {t("account.delete.confirm")}
              </label>
              <StatusLine notice={error ? { ok: false, text: error } : null} />
              <Button type="submit" variant="destructive" className="self-start" disabled={!confirmed || !password || busy}>
                {busy ? t("common.working") : t("account.delete.submit")}
              </Button>
            </FieldGroup>
          </form>
        </AccountSection>
      )}
    </>
  )
}

/** The public cancel leg: the account is signed out by then, so it proves itself with its password. */
export function CancelForm({ initialEmail = "" }: { initialEmail?: string }) {
  const { t } = useTranslations()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await cancelDeletion(email.trim(), password)
      setDone(true)
      setPassword("")
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountSection title={t("account.delete.cancelTitle")} description={t("account.delete.cancelHint")}>
      {done ? (
        <p role="status" className="flex items-start gap-2 text-sm text-pretty text-grid-fg">
          <CheckIcon className="mt-0.5 size-4 shrink-0" />
          {t("account.delete.cancelled")}
        </p>
      ) : (
        <form onSubmit={submit} className="max-w-md">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cancel-email">{t("auth.email")}</FieldLabel>
              <Input id="cancel-email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cancel-password">{t("account.delete.password")}</FieldLabel>
              <Input id="cancel-password" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <StatusLine notice={error ? { ok: false, text: error } : null} />
            <Button type="submit" variant="outline" className="self-start" disabled={!email || !password || busy}>
              {busy ? t("common.working") : t("account.delete.cancelSubmit")}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AccountSection>
  )
}
