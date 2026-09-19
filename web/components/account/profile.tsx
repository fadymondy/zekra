"use client"

import Link from "next/link"
import { useMemo, useState, type FormEvent } from "react"
import useSWR, { useSWRConfig } from "swr"

import { MIN_PASSWORD } from "@/components/auth/parts"
import { AccountSection, StatusLine } from "@/components/account/section"
import { LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getProfile, saveProfile, type AccountProfile } from "@/lib/account"
import { auth, authMessage } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"

type Notice = { ok: boolean; text: string } | null

export function useProfile() {
  return useSWR<AccountProfile>("/api/me/account/profile", getProfile, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
}

/** Name, avatar and timezone (fadymondy's ProfileForm). The address itself is read-only. */
export function ProfileSection() {
  const { t } = useTranslations()
  const me = useMe()
  const profile = useProfile()

  return (
    <AccountSection title={t("account.profile.title")} description={t("account.profile.hint")}>
      {profile.isLoading ? (
        <div className="-mx-6 -my-6">
          <LoadingRows rows={3} />
        </div>
      ) : profile.error ? (
        <div className="flex flex-col gap-2">
          {me.data?.email ? (
            <p dir="ltr" className="text-sm text-grid-fg rtl:text-end">
              {me.data.email}
            </p>
          ) : null}
          <p role="alert" className="text-sm text-grid-danger-text">
            {authMessage(profile.error, t)}
          </p>
        </div>
      ) : profile.data ? (
        <ProfileForm key={profile.data.email} profile={profile.data} />
      ) : null}
    </AccountSection>
  )
}

function ProfileForm({ profile }: { profile: AccountProfile }) {
  const { t } = useTranslations()
  const { mutate } = useSWRConfig()
  const [name, setName] = useState(profile.name ?? "")
  const [avatar, setAvatar] = useState(profile.avatar ?? "")
  const [timezone, setTimezone] = useState(profile.timezone ?? "")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const zones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [browserZone]
    return list.includes("UTC") ? list : ["UTC", ...list]
  }, [browserZone])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const saved = await saveProfile({ name: name.trim(), avatar: avatar.trim(), timezone })
      await mutate("/api/me/account/profile", saved, { revalidate: false })
      await mutate("/api/auth/me")
      setNotice({ ok: true, text: t("account.profile.saved") })
    } catch (err) {
      setNotice({ ok: false, text: authMessage(err, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md">
      <FieldGroup>
        <Field>
          <FieldLabel>{t("auth.email")}</FieldLabel>
          <p dir="ltr" className="text-sm text-grid-fg rtl:text-end">
            {profile.email}
          </p>
          <FieldDescription>{profile.verified ? t("account.profile.verified") : t("account.profile.unverified")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="name">{t("account.profile.name")}</FieldLabel>
          <Input id="name" dir="auto" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="avatar">{t("account.profile.avatar")}</FieldLabel>
          <Input id="avatar" dir="ltr" type="url" placeholder="https://…" value={avatar} onChange={(e) => setAvatar(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="timezone">{t("account.profile.timezone")}</FieldLabel>
          <select
            id="timezone"
            dir="ltr"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            <option value="">{t("account.profile.timezoneUnset")}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {!timezone && browserZone ? (
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setTimezone(browserZone)}>
              {t("account.profile.useZone", { zone: browserZone })}
            </Button>
          ) : null}
        </Field>
        <StatusLine notice={notice} />
        <Button type="submit" className="self-start" disabled={busy}>
          {busy ? t("common.working") : t("common.save")}
        </Button>
      </FieldGroup>
    </form>
  )
}

/** Change password; an account created through a provider has none yet and sets one by reset. */
export function PasswordSection() {
  const { t, locale } = useTranslations()
  const profile = useProfile()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  if (profile.data && profile.data.has_password === false) {
    return (
      <AccountSection title={t("account.password.title")}>
        <div className="flex max-w-md flex-col gap-3">
          <p className="text-sm text-pretty text-grid-muted">{t("account.password.none")}</p>
          <Button variant="outline" className="self-start" nativeButton={false} render={<Link href={`/${locale}/forgot-password`} />}>
            {t("account.password.setOne")}
          </Button>
        </div>
      </AccountSection>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    if (next.length < MIN_PASSWORD) return setNotice({ ok: false, text: t("auth.passwordTooShort", { min: MIN_PASSWORD }) })
    if (next !== confirm) return setNotice({ ok: false, text: t("auth.passwordMismatch") })
    setBusy(true)
    try {
      await auth.changePassword(current, next)
      setCurrent("")
      setNext("")
      setConfirm("")
      setNotice({ ok: true, text: t("account.password.changed") })
    } catch (err) {
      setNotice({ ok: false, text: authMessage(err, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountSection title={t("account.password.title")} description={t("account.password.hint")}>
      <form onSubmit={onSubmit} className="max-w-md" noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="current-password">{t("account.password.current")}</FieldLabel>
            <Input id="current-password" type="password" dir="ltr" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">{t("auth.newPassword")}</FieldLabel>
            <Input id="new-password" type="password" dir="ltr" autoComplete="new-password" maxLength={72} required value={next} onChange={(e) => setNext(e.target.value)} />
            <FieldDescription>{t("auth.passwordHint", { min: MIN_PASSWORD })}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">{t("auth.confirmPassword")}</FieldLabel>
            <Input id="confirm-password" type="password" dir="ltr" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <StatusLine notice={notice} />
          <Button type="submit" className="self-start" disabled={busy || !current || !next || !confirm}>
            {busy ? t("common.working") : t("account.password.submit")}
          </Button>
        </FieldGroup>
      </form>
    </AccountSection>
  )
}
