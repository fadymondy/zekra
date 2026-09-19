"use client"

import Link from "next/link"
import { useEffect, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSWRConfig } from "swr"

import { CodeInput, ErrorLine, MIN_PASSWORD, Notice, ProviderButtons, Submit, useLoginMethods } from "@/components/auth/parts"
import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { auth, AuthError, authMessage, safeNext } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

/*
  Sign-up, email verification and password recovery, ported from fadymondy.com-v2
  (components/auth/account-forms.tsx). The server does the deciding: a new account is unusable
  until the 6-digit code mailed to it is entered, and a reset code sets a new password and signs
  every other session out. These forms walk the visitor through it and never say whether an
  address has an account.
*/

function verifyHref(locale: string, email: string, next: string | null) {
  return `/${locale}/verify-email?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`
}

function Frame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const { t } = useTranslations()
  useDocumentTitle(title)
  return (
    <PublicFrame eyebrow={t("auth.eyebrow")} title={title} description={description}>
      <PublicPanel className="flex justify-center py-10">
        <div className="w-full max-w-sm">{children}</div>
      </PublicPanel>
    </PublicFrame>
  )
}

export function RegisterForm() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const params = useSearchParams()
  const methods = useLoginMethods()
  const next = safeNext(params.get("next"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(t("auth.passwordTooShort", { min: MIN_PASSWORD }))
    if (password !== confirm) return setError(t("auth.passwordMismatch"))
    setBusy(true)
    try {
      await auth.register(email.trim(), password, locale)
      // The server always asks for the code first.
      router.push(verifyHref(locale, email.trim(), next))
    } catch (err) {
      if (err instanceof AuthError && err.code === "email_unverified") {
        router.push(verifyHref(locale, err.email || email.trim(), next))
        return
      }
      setError(err instanceof AuthError && err.status === 409 ? t("auth.registrationFailed") : authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame title={t("auth.createAccount")} description={t("auth.registerHint")}>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
            <Input id="email" type="email" dir="ltr" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
            <Input id="password" type="password" dir="ltr" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} />
            <FieldDescription>{t("auth.passwordHint", { min: MIN_PASSWORD })}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm">{t("auth.confirmPassword")}</FieldLabel>
            <Input id="confirm" type="password" dir="ltr" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <ErrorLine error={error} />
          <Submit busy={busy} label={t("auth.createAccount")} disabled={!email || !password || !confirm} />
        </FieldGroup>
      </form>
      <ProviderButtons methods={methods} returnTo={next ?? `/${locale}/brains`} />
      <p className="mt-6 text-center text-sm text-grid-muted">
        {t("auth.haveAccount")}{" "}
        <Link href={`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-grid-fg underline underline-offset-4">
          {t("auth.signIn")}
        </Link>
      </p>
    </Frame>
  )
}

export function VerifyEmailForm() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const params = useSearchParams()
  const { mutate } = useSWRConfig()
  const next = safeNext(params.get("next"))
  const [email, setEmail] = useState(params.get("email") ?? "")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await auth.verifyEmail(email.trim(), code)
      // Verified and signed in; without a session (auth briefly unavailable), sign in by hand.
      if (result?.token || result?.user) {
        await mutate("/api/auth/me")
        router.replace(next ?? `/${locale}/brains`)
      } else {
        router.replace(`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`)
      }
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    setNote(null)
    try {
      await auth.resendVerification(email.trim(), locale)
      setNote(t("auth.codeResent"))
      setCooldown(60)
    } catch (err) {
      setError(authMessage(err, t))
    }
  }

  return (
    <Frame title={t("auth.verifyTitle")} description={t("auth.verifyIntro")}>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
            <Input id="email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="code">{t("auth.code")}</FieldLabel>
            <CodeInput autoFocus={!!email} value={code} onChange={setCode} />
          </Field>
          <Notice>{note}</Notice>
          <ErrorLine error={error} />
          <Submit busy={busy} label={t("auth.verify")} disabled={!email || code.length !== 6} />
          <Button type="button" variant="ghost" disabled={!email || cooldown > 0} onClick={() => void resend()}>
            {cooldown > 0 ? t("auth.resendIn", { seconds: cooldown }) : t("auth.resend")}
          </Button>
        </FieldGroup>
      </form>
    </Frame>
  )
}

export function ForgotPasswordForm() {
  const { t, locale } = useTranslations()
  const [step, setStep] = useState<"email" | "reset" | "done">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await auth.forgotPassword(email.trim(), locale)
      setStep("reset")
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(t("auth.passwordTooShort", { min: MIN_PASSWORD }))
    if (password !== confirm) return setError(t("auth.passwordMismatch"))
    setBusy(true)
    try {
      await auth.resetPassword(email.trim(), code, password)
      setStep("done")
    } catch (err) {
      setError(authMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  const loginLink = (
    <p className="mt-6 text-center text-sm">
      <Link href={`/${locale}/login`} className="text-grid-muted underline underline-offset-4 hover:text-grid-fg">
        {t("auth.backToLogin")}
      </Link>
    </p>
  )

  if (step === "done") {
    return (
      <Frame title={t("auth.forgotTitle")} description={t("auth.forgotIntro")}>
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm text-pretty text-grid-fg">
            {t("auth.resetDone")}
          </p>
          <Button size="lg" nativeButton={false} render={<Link href={`/${locale}/login`} />}>
            {t("auth.signIn")}
          </Button>
        </div>
      </Frame>
    )
  }

  return (
    <Frame title={t("auth.forgotTitle")} description={t("auth.forgotIntro")}>
      {step === "email" ? (
        <form onSubmit={sendCode} noValidate>
          <FieldGroup>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
              <Input id="email" type="email" dir="ltr" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <ErrorLine error={error} />
            <Submit busy={busy} label={t("auth.sendCode")} disabled={!email} />
          </FieldGroup>
        </form>
      ) : (
        <form onSubmit={reset} noValidate>
          <FieldGroup>
            <Notice>{t("auth.forgotSent", { email: email.trim() })}</Notice>
            <Field>
              <FieldLabel htmlFor="code">{t("auth.code")}</FieldLabel>
              <CodeInput autoFocus value={code} onChange={setCode} />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{t("auth.newPassword")}</FieldLabel>
              <Input id="password" type="password" dir="ltr" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <FieldDescription>{t("auth.passwordHint", { min: MIN_PASSWORD })}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm">{t("auth.confirmPassword")}</FieldLabel>
              <Input id="confirm" type="password" dir="ltr" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <ErrorLine error={error} />
            <Submit busy={busy} label={t("auth.setPassword")} disabled={code.length !== 6 || !password || !confirm} />
            <Button type="button" variant="ghost" onClick={() => setStep("email")}>
              {t("auth.useAnotherEmail")}
            </Button>
          </FieldGroup>
        </form>
      )}
      {loginLink}
    </Frame>
  )
}
