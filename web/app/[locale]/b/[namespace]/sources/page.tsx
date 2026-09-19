"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { DetailStrip, SectionHeader, SectionTitle } from "@/components/page"
import { AddSourceDialog } from "@/components/sources/add-source-dialog"
import { SourceRow } from "@/components/sources/source-row"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"
import { useDatasources } from "@/lib/sources"
import { useDocumentTitle } from "@/lib/title"

export default function BrainSourcesPage() {
  const { t, formatNumber, timeAgo } = useTranslations()
  const params = useParams<{ namespace: string }>()
  const namespace = decodeURIComponent(params.namespace)
  useDocumentTitle(`${t("sources.title")} · ${namespace}`)
  const [adding, setAdding] = useState(false)

  const sources = useDatasources(namespace)
  const list = sources.data ?? []
  const docs = list.reduce((n, s) => n + (s.docCount ?? 0), 0)
  const lastSync = list.map((s) => s.lastSyncAt).filter(Boolean).sort().at(-1)
  const reload = () => void sources.mutate()

  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon /> {t("sources.add")}
    </Button>
  )

  return (
    <div>
      <SectionHeader micro={t("sources.micro")} title={t("sources.title")} description={t("sources.description")} action={addButton} />

      {list.length > 0 ? (
        <DetailStrip
          items={[
            { label: t("sources.statSources"), value: formatNumber(list.length) },
            { label: t("sources.statDocs"), value: formatNumber(docs) },
            { label: t("sources.statErrors"), value: formatNumber(list.filter((s) => s.status === "error").length) },
            { label: t("sources.statLastSync"), value: lastSync ? timeAgo(lastSync) : t("common.never") },
          ]}
        />
      ) : null}

      <SectionTitle>{t("sources.connected")}</SectionTitle>
      {sources.error ? (
        <ErrorState error={sources.error} />
      ) : sources.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("sources.emptyTitle")} body={t("sources.emptyBody")} action={addButton} />
      ) : (
        <ol className="divide-y divide-line border-y border-line" aria-label={t("sources.connected")}>
          {list.map((s) => (
            <SourceRow key={s.id} s={s} onChanged={reload} />
          ))}
        </ol>
      )}

      <AddSourceDialog namespace={namespace} open={adding} onOpenChange={setAdding} onCreated={reload} />
    </div>
  )
}
