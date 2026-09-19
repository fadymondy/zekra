"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { DataExport, ExportDownload } from "@/components/account/data-export"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

// Request an export and follow its status; the export email's one-time link lands here as ?token=.
function ExportBody() {
  const token = useSearchParams().get("token")
  return (
    <>
      {token !== null ? <ExportDownload token={token} /> : null}
      <DataExport />
    </>
  )
}

export default function ExportPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.export.title"))
  return (
    <div className="pb-10">
      <SectionHeader micro={t("account.micro")} title={t("account.export.title")} description={t("account.export.help")} />
      <Suspense>
        <ExportBody />
      </Suspense>
    </div>
  )
}
