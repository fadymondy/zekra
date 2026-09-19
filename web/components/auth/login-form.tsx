"use client"

import Link from "next/link"
import { useEffect, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSWRConfig } from "swr"

import { CodeInput, ErrorLine, Notice, ProviderButtons, Submit, useLoginMethods } from "@/components/auth/parts"
import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { auth, AuthError, authMessage, safeNext } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

// What the OAuth callbacks may report as /login?error=<provider>_<reason>.
const OAUTH_REASONS = ["cancelled", "closed", "state", "email"]

/**
 * Sign in, ported from fadymondy.com-v2's LoginForm: password or an emailed 6-digit code, then the
 * two-factor step when the account has it on. Provider buttons render only when advertised.
 */
export function LoginForm() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const params = useSearchParams()
  const { mutate } = useSWRConfig()
  const methods = useLoginMethods()
  const next = safeNext(params.get("next"))
  const home = `/${locale}/brains`

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"password" | "code">("password")
  const [codeSent, setCodeSent] = useState(false)
  const [otp, setOtp] = useState("")
  const [challenge, setChallenge] = useState<string | null>(null)
  const [second, setSecond] = useState("")
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useDocumentTitle(challenge ? t("auth.twoFactorTitle") : t("auth.signIn"))

  // A password-less deployment: open straight on the emailed code.
  useEffect(() => {
    if (methods && !methods.password && methods.code) setMode("code")
  }, [methods])

  // The provider callbacks come back as ?error=<provider>[_<reason>] when they could not finish.
  const oauthError = params.get("error")
  useEffect(() => {
    if (!oauthError) return
    const m = /^(google|github|apple)(?:_(\w+))?$/.exec(oauthError)
    if (!m) return setError(t("auth.oauth.state"))
    const provider = { google: "Google", github: "GitHub", apple: "Apple" }[m[1] as "google"]
    const reason = m[2] && OAUTH_REASONS.includes(m[2]) ? m[2] : "failed"
    setError(t(`auth.oauth.${reason}`, { provider }))
  }, [oauthError, t])

  async function finish() {
    await mutate("/api/auth/me")
    const to = next ?? home
    // An API route (an SSO handoff) is not a page the router can render.
    if (to.startsWith("/api/")) window.location.assign(to)
    else router.replace(to)
  }

  function refused(err: unknown) {
    if (err instanceof AuthError && err.code === "email_unverified") {
      router.push(`/${locale}/verify-email?email=${encodeURIComponent(err.email || email.trim())}`)
      return
    }
    if (err instanceof AuthError && err.code === "2fa_required" && err.challenge) {
      setChallenge(err.challenge)
      setSecond("")
      return
    }
    if (err instanceof AuthError && err.code === "challenge_expired") setChallenge(null)
    setError(authMessage(err, t))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (challenge) {
        await auth.challenge(challenge, useRecovery ? { recovery_code: second.trim() } : { code: second })
        await finish()
      } else if (mode === "code" && !codeSent) {
        await auth.requestCode(email.trim(), locale)
        setCodeSent(true)
      } else if (mode === "code") {
        await auth.signInWithCode(email.trim(), otp)
        await finish()
      } else {
        await auth.login(email.trim(), password, locale)
        await finish()
      }
    } catch (err) {
      refused(err)
    } finally {
      setBusy(false)
    }
  }

  const registerHref = `/${locale}/register${next ? `?next=${encodeURIComponent(next)}` : ""}`

  if (challenge) {
    return (
      <PublicFrame eyebrow={t("auth.welcomeBack")} title={t("auth.twoFactorTitle")} description={useRecovery ? t("auth.recoveryIntro") : t("auth.twoFactorIntro")}>
        <PublicPanel className="flex justify-center py-10">
          <div className="w-full max-w-sm">
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={!!error || undefined}>
                  <FieldLabel htmlFor="second">{useRecovery ? t("auth.recoveryCode") : t("auth.appCode")}</FieldLabel>
                  {useRecovery ? (
                    <Input
                      id="second"
                      dir="ltr"
                      autoComplete="one-time-code"
                      maxLength={20}
                      required
                      autoFocus
                      className="font-mono text-lg tracking-[0.2em]"
                      value={second}
                      onChange={(e) => setSecond(e.target.value)}
                    />
                  ) : (
                    <CodeInput id="second" autoFocus value={second} onChange={setSecond} />
                  )}
                </Field>
                <ErrorLine error={error} />
                <Submit busy={busy} label={t("auth.continue")} disabled={!second || (!useRecovery && second.length !== 6)} />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setUseRecovery((v) => !v)
                    setSecond("")
                    setError(null)
                  }}
                >
                  {useRecovery ? t("auth.useAppCode") : t("auth.useRecovery")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setChallenge(null)
                    setError(null)
                  }}
                >
                  {t("auth.startOver")}
                </Button>
              </FieldGroup>
            </form>
          </div>
        </PublicPanel>
      </PublicFrame>
    )
  }

  const canSwitch = !methods || (methods.password && methods.code)

  return (
    <PublicFrame eyebrow={t("auth.welcomeBack")} title={t("auth.signIn")} description={t("auth.signInHint")}>
      <PublicPanel className="flex justify-center py-10">
        <div className="w-full max-w-sm" data-auth-form>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <Field data-invalid={!!error || undefined}>
                <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={mode === "code" && codeSent}
                />
              </Field>

              {mode === "code" ? (
                codeSent ? (
                  <Field data-invalid={!!error || undefined}>
                    <FieldLabel htmlFor="otp">{t("auth.code")}</FieldLabel>
                    <CodeInput id="otp" autoFocus value={otp} onChange={setOtp} />
                    <Notice>{t("auth.codeSent", { email: email.trim() })}</Notice>
                  </Field>
                ) : null
              ) : (
                <Field data-invalid={!!error || undefined}>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
                    <Link
                      href={`/${locale}/forgot-password`}
                      className="text-xs text-grid-muted underline underline-offset-4 hover:text-grid-fg"
                    >
                      {t("auth.forgotLink")}
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    dir="ltr"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}

              <ErrorLine error={error} />

              <Submit
                busy={busy}
                label={mode === "code" && !codeSent ? t("auth.sendCode") : t("auth.signIn")}
                disabled={!email || (mode === "password" ? !password : codeSent && otp.length !== 6)}
              />

              {mode === "code" && codeSent ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCodeSent(false)
                    setOtp("")
                    setError(null)
                  }}
                >
                  {t("auth.useAnotherEmail")}
                </Button>
              ) : null}

              {canSwitch ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMode((m) => (m === "password" ? "code" : "password"))
                    setCodeSent(false)
                    setOtp("")
                    setError(null)
                  }}
                >
                  {mode === "password" ? t("auth.useEmailCode") : t("auth.usePassword")}
                </Button>
              ) : null}
            </FieldGroup>
          </form>

          <ProviderButtons methods={methods} returnTo={next ?? home} />

          <p className="mt-6 text-center text-sm text-grid-muted">
            {t("auth.noAccount")}{" "}
            <Link href={registerHref} className="font-medium text-grid-fg underline underline-offset-4">
              {t("auth.createAccount")}
            </Link>
          </p>
        </div>
      </PublicPanel>
    </PublicFrame>
  )
}
