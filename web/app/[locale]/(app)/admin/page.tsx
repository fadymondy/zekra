"use client"

import { Button } from "@fadymondy/nasaq/web"

import Link from "next/link"

import { BotIcon, BrainIcon, CircleHelpIcon, DatabaseIcon, KeyRoundIcon, RocketIcon, SparklesIcon, WaypointsIcon } from "lucide-react"
import { CardList, PageBody, Panel, SectionHeader, StatStrip } from "@/components/page"
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

      <PageBody>
        {stats.error ? (
          <ErrorState error={stats.error} />
        ) : (
          <>
            <StatStrip
              loading={stats.isLoading}
              items={[
                { icon: <BrainIcon />, label: t("admin.stat.brains"), value: n(s?.brains) },
                { icon: <DatabaseIcon />, label: t("admin.stat.memories"), value: n(s?.memories) },
                { icon: <KeyRoundIcon />, label: t("admin.stat.tokens"), value: n(activeTokens) },
                { icon: <BotIcon />, label: t("admin.stat.agents"), value: n(s?.agents) },
              ]}
            />
            <StatStrip
              loading={stats.isLoading}
              items={[
                { icon: <WaypointsIcon />, label: t("admin.stat.entities"), value: n(s?.entities) },
                { icon: <SparklesIcon />, label: t("admin.stat.recalls24h"), value: n(s?.recalls24h) },
                { icon: <RocketIcon />, label: t("admin.stat.sessions24h"), value: n(s?.sessions24h) },
                { icon: <CircleHelpIcon />, label: t("admin.stat.openGaps"), value: n(s?.openGaps) },
              ]}
            />
          </>
        )}

        <Panel title={t("admin.overview.accounts")}>
          {admin.error ? (
            <AdminErrorState error={admin.error} what={t("admin.overview.accountsNotLive")} />
          ) : admin.isLoading ? (
            <LoadingRows rows={1} />
          ) : (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(admin.data ?? {})
                .filter(([, v]) => typeof v === "number")
                .slice(0, 8)
                .map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-nq-surface-soft px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">{ACCOUNT_STATS.includes(k) ? t(`admin.accountStat.${k}`) : k}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatNumber(v as number)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </Panel>

        <Panel
          title={t("admin.overview.recent")}
          action={
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/${locale}/admin/activity`} />}>
              {t("common.viewAll")}
            </Button>
          }
        >
          {activity.error ? (
            <ErrorState error={activity.error} />
          ) : activity.isLoading ? (
            <LoadingRows />
          ) : recent.length === 0 ? (
            <EmptyState title={t("admin.activity.empty")} body={t("admin.activity.emptyBody")} />
          ) : (
            <CardList label={t("admin.overview.recent")}>
              {recent.map((a) => (
                <ActivityRow key={a.id} a={a} />
              ))}
            </CardList>
          )}
        </Panel>
      </PageBody>
    </>
  )
}
