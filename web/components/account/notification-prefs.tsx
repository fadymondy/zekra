"use client"

import { useState } from "react"
import useSWR from "swr"

import { StatusLine } from "@/components/account/section"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Switch } from "@/components/ui/switch"
import { getPrefs, savePrefs, type AccountPrefs } from "@/lib/account"
import { authMessage } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"

/**
 * Notification preferences (fadymondy's NotificationPrefs). The API owns the list: every boolean it
 * returns is one switch, saved optimistically and rolled back on refusal. Known keys get a
 * translated label and hint; an unknown one shows its key so a new preference is never hidden.
 */
export function NotificationPrefs() {
  const { t } = useTranslations()
  const prefs = useSWR<AccountPrefs>("/api/me/account/notifications", getPrefs, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [error, setError] = useState<string | null>(null)

  if (prefs.isLoading) return <LoadingRows rows={2} />
  if (prefs.error) return <ErrorState error={prefs.error} />

  const keys = Object.keys(prefs.data ?? {}).filter((k) => typeof prefs.data?.[k] === "boolean")
  if (keys.length === 0) return <EmptyState title={t("account.notifications.empty")} />

  const label = (k: string) => {
    const key = `account.notifications.key.${k}`
    const v = t(key)
    return v === key ? k.replace(/_/g, " ") : v
  }
  const hint = (k: string) => {
    const key = `account.notifications.hint.${k}`
    const v = t(key)
    return v === key ? null : v
  }

  async function toggle(k: string, checked: boolean) {
    const before = prefs.data!
    const after = { ...before, [k]: checked }
    setError(null)
    await prefs.mutate(after, { revalidate: false })
    try {
      await prefs.mutate(await savePrefs(after), { revalidate: false })
    } catch (err) {
      await prefs.mutate(before, { revalidate: false })
      setError(authMessage(err, t))
    }
  }

  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {keys.map((k) => (
          <li key={k} className="flex items-start gap-4 px-6 py-3">
            <div className="min-w-0 flex-1">
              <label htmlFor={`pref-${k}`} className="text-sm font-medium text-grid-fg first-letter:uppercase">
                {label(k)}
              </label>
              {hint(k) ? <p className="text-xs text-pretty text-grid-muted">{hint(k)}</p> : null}
            </div>
            <Switch id={`pref-${k}`} checked={!!prefs.data?.[k]} onCheckedChange={(v) => void toggle(k, v)} />
          </li>
        ))}
      </ul>
      {error ? (
        <div className="px-6 py-4">
          <StatusLine notice={{ ok: false, text: error }} />
        </div>
      ) : null}
    </>
  )
}
