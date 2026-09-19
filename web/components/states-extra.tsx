"use client"

import Link from "next/link"
import { ShieldAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"

/** 403 inside the shell: signed in, but without the role this area needs. */
export function ForbiddenState() {
  const { t, locale } = useTranslations()
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <ShieldAlertIcon className="size-8 text-grid-muted" />
      <h1 className="text-lg font-medium text-grid-fg">{t("forbidden.title")}</h1>
      <p className="grid-body max-w-md text-sm">{t("forbidden.body")}</p>
      <Button variant="outline" nativeButton={false} render={<Link href={`/${locale}/brains`} />}>
        {t("forbidden.back")}
      </Button>
    </div>
  )
}
