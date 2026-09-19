"use client"

import useSWR from "swr"

import { Button } from "@/components/ui/button"
import { Field, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { parseMethods, PROVIDER_NAMES, type LoginMethods, type Provider } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const MIN_PASSWORD = 8

/*
  Google's "G" is a third-party mark whose branding rules require its own four colours, so these
  fills are the one deliberate exception to "never hardcode a colour".
*/
export function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#EA4335" d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z" />
      <path fill="#4285F4" d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#FBBC05" d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z" />
    </svg>
  )
}

/** Single-colour marks: they follow the button's text colour. */
export function AppleMark() {
  return (
    <svg viewBox="0 0 814 1000" aria-hidden="true">
      <path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  )
}

export function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export const PROVIDER_MARKS: Record<Provider, () => React.JSX.Element> = {
  google: GoogleMark,
  github: GitHubMark,
  apple: AppleMark,
}

/** What /api/auth/methods advertises. `undefined` while loading. */
export function useLoginMethods(): LoginMethods | undefined {
  const { data, error } = useSWR(
    "/api/auth/methods",
    async (p: string) => {
      const res = await fetch(p, { credentials: "same-origin", cache: "no-store" })
      return res.ok ? res.json() : { methods: [] }
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  if (error) return parseMethods(null)
  return data === undefined ? undefined : parseMethods(data)
}

/** A 6-digit code field: numeric keyboard, one-time-code autofill, always LTR. */
export function CodeInput({
  id = "code",
  value,
  onChange,
  autoFocus,
  className,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  className?: string
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      dir="ltr"
      required
      autoFocus={autoFocus}
      className={cn("font-mono text-lg tracking-[0.4em]", className)}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
    />
  )
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <FieldError>{error}</FieldError> : null
}

export function Notice({ children }: { children: React.ReactNode }) {
  return children ? (
    <p role="status" className="text-sm text-grid-muted">
      {children}
    </p>
  ) : null
}

export function Submit({ busy, label, disabled }: { busy: boolean; label: string; disabled?: boolean }) {
  const { t } = useTranslations()
  return (
    <Field>
      <Button type="submit" size="lg" disabled={busy || disabled}>
        {busy ? t("common.working") : label}
      </Button>
    </Field>
  )
}

/** Mahaam's "or" rule. */
export function OrRule() {
  const { t } = useTranslations()
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="grid-micro">{t("auth.or")}</span>
      <Separator className="flex-1" />
    </div>
  )
}

/**
 * The social sign-in buttons: only providers the API advertises render. A real navigation, not
 * fetch: the flow is a chain of redirects through the provider that ends with the session cookie.
 */
export function ProviderButtons({ methods, returnTo }: { methods: LoginMethods | undefined; returnTo: string }) {
  const { t } = useTranslations()
  const providers = (["google", "github", "apple"] as Provider[]).filter((p) => methods?.providers[p])
  if (providers.length === 0) return null
  return (
    <div className="mt-6 space-y-3">
      <OrRule />
      {providers.map((p) => {
        const Mark = PROVIDER_MARKS[p]
        const href = methods!.providers[p]!
        return (
          <Button
            key={p}
            variant={p === "apple" ? "default" : "outline"}
            size="lg"
            className={cn(
              "w-full [&_svg]:size-4",
              // Apple's guidelines: a black button, white in dark mode.
              p === "apple" && "border-transparent bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85",
            )}
            nativeButton={false}
            render={<a href={`${href}${href.includes("?") ? "&" : "?"}redirect=${encodeURIComponent(returnTo)}`} />}
          >
            <Mark />
            {t("auth.continueWith", { provider: PROVIDER_NAMES[p] })}
          </Button>
        )
      })}
    </div>
  )
}
