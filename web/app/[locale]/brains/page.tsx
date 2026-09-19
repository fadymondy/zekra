"use client"

import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"

export default function BrainsPage() {
  const { t } = useTranslations()
  return <SectionHeader micro={t("nav.brains")} title={t("nav.brains")} />
}
