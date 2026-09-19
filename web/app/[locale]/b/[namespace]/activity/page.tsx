"use client"

import { useMemo } from "react"
import { useParams } from "next/navigation"

import { ActivityRow } from "@/components/activity/activity-row"
import { DetailStrip, RowList, SectionHeader, SectionTitle } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useBrainActivity } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function BrainActivityPage() {
  const { t, formatNumber } = useTranslations()
  const ns = decodeURIComponent(useParams<{ namespace: string }>().namespace)
  useDocumentTitle(`${t("activity.title")} · ${ns}`)
  const { rows, isLoading, error } = useBrainActivity(ns)

  const counts = useMemo(
    () => ({
      recalls: rows.filter((r) => r.op === "recall").length,
      writes: rows.filter((r) => r.op === "retain" || r.op === "reconsolidate").length,
      errors: rows.filter((r) => r.outcome === "error").length,
    }),
    [rows],
  )
  const v = (n: number) => (isLoading ? "—" : formatNumber(n))

  return (
    <>
      <SectionHeader
        micro={t("activity.micro")}
        title={t("activity.title")}
        description={t("activity.description", { brain: "\u2068" + ns + "\u2069" })}
      />
      <DetailStrip
        items={[
          { label: t("activity.stat.operations"), value: v(rows.length) },
          { label: t("activity.stat.recalls"), value: v(counts.recalls) },
          { label: t("activity.stat.writes"), value: v(counts.writes) },
          {
            label: t("activity.stat.errors"),
            value: <span className={counts.errors ? "text-grid-danger" : undefined}>{v(counts.errors)}</span>,
          },
        ]}
      />
      <SectionTitle
        action={
          rows.length > 0 ? (
            <span className="grid-micro">{t("activity.liveCount", { count: formatNumber(rows.length) })}</span>
          ) : null
        }
      >
        {t("activity.log")}
      </SectionTitle>
      {error ? (
        <ErrorState error={error} />
      ) : isLoading ? (
        <LoadingRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("activity.empty")} body={t("activity.emptyBody")} />
      ) : (
        <RowList label={t("activity.log")}>
          {rows.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </RowList>
      )}
    </>
  )
}
