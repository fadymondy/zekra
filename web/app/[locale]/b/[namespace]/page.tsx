"use client"

import { useParams } from "next/navigation"

import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"

export default function BrainOverviewPage() {
  const { t } = useTranslations()
  const { namespace } = useParams<{ namespace: string }>()
  return <SectionHeader micro={t("nav.overview")} title={<span dir="ltr">{decodeURIComponent(namespace)}</span>} />
}
