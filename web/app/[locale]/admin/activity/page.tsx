"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DetailStrip, RowList, SectionHeader } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ActivityRow } from "@/components/admin/activity-row"
import { useActivity } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

const ALL = "__all"

export default function AdminActivityPage() {
  const { t, formatNumber } = useTranslations()
  useDocumentTitle(t("nav.systemActivity"))
  const activity = useActivity(500)
  const [brain, setBrain] = useState(ALL)
  const [op, setOp] = useState(ALL)

  const items = useMemo(() => activity.data ?? [], [activity.data])
  const brains = useMemo(() => [...new Set(items.map((i) => i.namespace).filter(Boolean))].sort(), [items])
  const ops = useMemo(() => [...new Set(items.map((i) => i.op).filter(Boolean))].sort(), [items])
  const rows = useMemo(
    () => items.filter((i) => (brain === ALL || i.namespace === brain) && (op === ALL || i.op === op)),
    [items, brain, op],
  )
  const counts = useMemo(
    () => ({
      recalls: rows.filter((r) => r.op === "recall" || r.op === "search").length,
      writes: rows.filter((r) => r.op === "retain" || r.op === "reconsolidate").length,
      errors: rows.filter((r) => r.outcome === "error").length,
    }),
    [rows],
  )

  const brainItems = [{ value: ALL, label: t("admin.activity.allBrains") }, ...brains.map((b) => ({ value: b, label: b }))]
  const opItems = [{ value: ALL, label: t("admin.activity.allOps") }, ...ops.map((o) => ({ value: o, label: o }))]
  const filtered = brain !== ALL || op !== ALL

  return (
    <>
      <SectionHeader micro={t("admin.micro")} title={t("nav.systemActivity")} description={t("admin.activity.hint")} />

      <DetailStrip
        items={[
          { label: t("admin.activity.operations"), value: formatNumber(rows.length) },
          { label: t("admin.activity.recalls"), value: formatNumber(counts.recalls) },
          { label: t("admin.activity.writes"), value: formatNumber(counts.writes) },
          { label: t("admin.activity.errors"), value: <span className={counts.errors ? "text-grid-danger-text" : undefined}>{formatNumber(counts.errors)}</span> },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 px-6 py-4">
        <Select items={brainItems} value={brain} onValueChange={(v) => setBrain(String(v ?? ALL))}>
          <SelectTrigger aria-label={t("admin.activity.brain")} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {brainItems.map((b) => (
              <SelectItem key={b.value} value={b.value}>
                {b.value === ALL ? b.label : <span dir="ltr" className="font-mono">{b.label}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={opItems} value={op} onValueChange={(v) => setOp(String(v ?? ALL))}>
          <SelectTrigger aria-label={t("admin.activity.op")} className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.value === ALL ? o.label : <span dir="ltr" className="font-mono">{o.label}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => { setBrain(ALL); setOp(ALL) }}>
            {t("admin.activity.clear")}
          </Button>
        ) : null}
        <span className="ms-auto text-xs text-grid-muted">{t("admin.activity.window", { n: formatNumber(items.length) })}</span>
      </div>

      {activity.error ? (
        <ErrorState error={activity.error} />
      ) : activity.isLoading ? (
        <LoadingRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title={filtered ? t("admin.activity.noMatch") : t("admin.activity.empty")} body={filtered ? undefined : t("admin.activity.emptyBody")} />
      ) : (
        <RowList label={t("nav.systemActivity")} className="mb-8">
          {rows.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </RowList>
      )}
    </>
  )
}
