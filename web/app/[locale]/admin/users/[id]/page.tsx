"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DetailStrip, SectionHeader, SectionTitle } from "@/components/page"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { NotFoundState } from "@/components/not-found-state"
import { LoadingRows } from "@/components/states"
import { AdminErrorState } from "@/components/admin/not-live"
import { toastError } from "@/components/admin/toast-error"
import { UserStatusBadge } from "@/components/admin/user-status"
import { ApiError } from "@/lib/api"
import { adminApi, USER_ROLES, useAdminUser } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

export default function AdminUserDetailPage() {
  const { id: raw } = useParams<{ id: string }>()
  const id = decodeURIComponent(raw)
  const router = useRouter()
  const { t, locale, isRtl, formatDate, timeAgo } = useTranslations()
  const me = useMe()
  const user = useAdminUser(id)
  const back = `/${locale}/admin/users`
  useDocumentTitle(user.data?.email ?? t("nav.users"))

  const [roles, setRoles] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const backLink = (
    <div className="px-6 pt-5">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg">
        <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
        {t("nav.users")}
      </Link>
    </div>
  )

  if (user.error && user.error instanceof ApiError && user.error.status === 404 && /user/i.test(user.error.message)) {
    return <NotFoundState title={t("admin.user.notFound")} body={t("admin.user.notFoundBody")} backHref={back} backLabel={t("nav.users")} />
  }
  if (user.error) {
    return (
      <>
        {backLink}
        <SectionHeader micro={t("admin.micro")} title={t("nav.users")} />
        <AdminErrorState error={user.error} what={t("admin.users.notLive")} />
      </>
    )
  }
  if (user.isLoading || !user.data) return <LoadingRows rows={5} />

  const u = user.data
  const isSelf = me.data ? String(me.data.id) === String(u.id) : false
  const current = roles ?? (u.roles.length ? u.roles : ["member"])
  const dirty = roles !== null && [...roles].sort().join() !== [...(u.roles.length ? u.roles : ["member"])].sort().join()

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await user.mutate()
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
    }
  }

  function toggleRole(role: string, on: boolean) {
    const next = on ? [...new Set([...current, role])] : current.filter((r) => r !== role)
    setRoles(next.length ? next : ["member"])
  }

  return (
    <>
      {backLink}
      <SectionHeader
        micro={t("admin.micro")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Ltr>{u.email}</Ltr>
            <UserStatusBadge user={u} />
          </span>
        }
        description={u.name ? <span dir="auto">{u.name}</span> : undefined}
      />

      <DetailStrip
        items={[
          { label: t("admin.user.verified"), value: u.email_verified ? t("admin.user.yes") : t("admin.user.no") },
          { label: t("admin.user.twoFactor"), value: u.two_factor === undefined ? "—" : u.two_factor ? t("admin.user.on") : t("admin.user.off") },
          { label: t("admin.users.joined"), value: formatDate(u.created_at) },
          {
            label: t("admin.user.lastLogin"),
            value: u.last_login_at ? <span title={formatDate(u.last_login_at, { dateStyle: "medium", timeStyle: "short" })}>{timeAgo(u.last_login_at)}</span> : t("common.never"),
          },
        ]}
      />

      <SectionTitle>{t("admin.users.roles")}</SectionTitle>
      <p className="-mt-1 px-6 pb-3 text-sm text-grid-muted">{isSelf ? t("admin.user.rolesSelf") : t("admin.user.rolesHint")}</p>
      <ul className="divide-y divide-line border-y border-line">
        {USER_ROLES.map((r) => {
          const fid = `role-${r}`
          return (
            <li key={r}>
              <label htmlFor={fid} className="flex cursor-pointer items-start gap-3 px-6 py-3 text-sm">
                <Checkbox id={fid} className="mt-0.5" checked={current.includes(r)} disabled={busy || isSelf} onCheckedChange={(v) => toggleRole(r, v === true)} />
                <span className="min-w-0">
                  <span className="block font-medium text-grid-fg">{t(`admin.role.${r}`)}</span>
                  <span className="block text-grid-muted">{t(`admin.roleHint.${r}`)}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-2 px-6 py-4">
        <Button disabled={!dirty || busy || isSelf} onClick={() => act(() => adminApi.setRoles(u.id, current), t("admin.user.rolesSaved")).then(() => setRoles(null))}>
          {busy ? t("common.saving") : t("admin.user.saveRoles")}
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setRoles(null)}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>

      <SectionTitle>{t("admin.user.actions")}</SectionTitle>
      <ul className="mb-8 divide-y divide-line border-y border-line">
        {!u.email_verified ? (
          <ActionRow title={t("admin.user.resendTitle")} body={t("admin.user.resendBody")}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => adminApi.resendVerification(u.id), t("admin.user.resent"))}>
              {t("admin.user.resend")}
            </Button>
          </ActionRow>
        ) : null}
        <ActionRow
          title={u.disabled ? t("admin.user.enableTitle") : t("admin.user.disableTitle")}
          body={u.disabled ? t("admin.user.enableBody") : t("admin.user.disableBody")}
        >
          {u.disabled ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => adminApi.enable(u.id), t("admin.user.enabled"))}>
              {t("admin.user.enable")}
            </Button>
          ) : isSelf ? (
            <Badge variant="outline">{t("admin.user.you")}</Badge>
          ) : (
            <ConfirmButton
              label={t("admin.user.disable")}
              title={t("admin.user.disableTitle")}
              description={t("admin.user.disableConfirm", { email: u.email })}
              confirmLabel={t("admin.user.disable")}
              onConfirm={() => act(() => adminApi.disable(u.id), t("admin.user.disabled"))}
            />
          )}
        </ActionRow>
        <ActionRow title={t("admin.user.deleteTitle")} body={t("admin.user.deleteBody")}>
          {isSelf ? (
            <Badge variant="outline">{t("admin.user.you")}</Badge>
          ) : (
            <ConfirmButton
              label={t("common.delete")}
              title={t("admin.user.deleteTitle")}
              description={t("admin.user.deleteConfirm", { email: u.email })}
              confirmLabel={t("common.delete")}
              onConfirm={async () => {
                try {
                  await adminApi.deleteUser(u.id)
                  toast.success(t("admin.user.deleted"))
                  router.push(back)
                } catch (err) {
                  toastError(err, locale)
                }
              }}
            />
          )}
        </ActionRow>
      </ul>
    </>
  )
}


function ActionRow({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-grid-fg">{title}</span>
        <span className="block text-grid-muted">{body}</span>
      </span>
      {children}
    </li>
  )
}
