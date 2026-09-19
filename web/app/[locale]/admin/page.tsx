"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { DetailStrip, RowList, SectionHeader, SectionTitle } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ActivityRow } from "@/components/admin/activity-row"
import { AdminErrorState } from "@/components/admin/not-live"
import { useActivity, useAdminStats, useStats, useTokens } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

// Known /api/admin/stats metrics; anything else shows its raw key.
const ACCOUNT_STATS = ["users", "admins", "verified", "unverified", "disabled", "signups7d", "active24h", "twoFactor"]

export default function AdminOverviewPage() {
  const { t, locale, formatNumber } = useTranslations()
  useDocumentTitle(t("nav.adminOverview"))
  const stats = useStats()
  const tokens = useTokens()
  const activity = useActivity(50)
  const admin = useAdminStats()

  const n = (v: number | undefined) => (v === undefined ? "—" : formatNumber(v))
  const s = stats.data
  const activeTokens = tokens.data?.filter((tok) => !tok.revoked).length
  const recent = (activity.data ?? []).slice(0, 12)

  return (
    <>
      <SectionHeader micro={t("admin.micro")} title={t("admin.overview.title")} description={t("admin.overview.hint")} />

      {stats.error ? (
        <ErrorState error={stats.error} />
      ) : (
        <>
          <DetailStrip
            items={[
              { label: t("admin.stat.brains"), value: n(s?.brains) },
              { label: t("admin.stat.memories"), value: n(s?.memories) },
              { label: t("admin.stat.tokens"), value: n(activeTokens) },
              { label: t("admin.stat.agents"), value: n(s?.agents) },
            ]}
          />
          <DetailStrip
            className="-mt-px"
            items={[
              { label: t("admin.stat.entities"), value: n(s?.entities) },
              { label: t("admin.stat.recalls24h"), value: n(s?.recalls24h) },
              { label: t("admin.stat.sessions24h"), value: n(s?.sessions24h) },
              { label: t("admin.stat.openGaps"), value: n(s?.openGaps) },
            ]}
          />
        </>
      )}

      <SectionTitle>{t("admin.overview.accounts")}</SectionTitle>
      {admin.error ? (
        <AdminErrorState error={admin.error} what={t("admin.overview.accountsNotLive")} />
      ) : admin.isLoading ? (
        <LoadingRows rows={1} />
      ) : (
        <DetailStrip
          items={Object.entries(admin.data ?? {})
            .filter(([, v]) => typeof v === "number")
            .slice(0, 8)
            .map(([k, v]) => ({ label: ACCOUNT_STATS.includes(k) ? t(`admin.accountStat.${k}`) : k, value: formatNumber(v) }))}
        />
      )}

      <SectionTitle
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/${locale}/admin/activity`} />}>
            {t("common.viewAll")}
          </Button>
        }
      >
        {t("admin.overview.recent")}
      </SectionTitle>
      {activity.error ? (
        <ErrorState error={activity.error} />
      ) : activity.isLoading ? (
        <LoadingRows />
      ) : recent.length === 0 ? (
        <EmptyState title={t("admin.activity.empty")} body={t("admin.activity.emptyBody")} />
      ) : (
        <RowList label={t("admin.overview.recent")} className="mb-8">
          {recent.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </RowList>
      )}
    </>
  )
}
