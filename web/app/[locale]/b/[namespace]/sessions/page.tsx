"use client"

import { useParams } from "next/navigation"
import { RocketIcon, RotateCcwIcon } from "lucide-react"

import { SectionHeader, SectionTitle } from "@/components/page"
import { SessionResultView, WriteToggle, useLaunchSession } from "@/components/sessions/launch-session"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function BrainSessionsPage() {
  const { t } = useTranslations()
  const params = useParams<{ namespace: string }>()
  const namespace = decodeURIComponent(params.namespace)
  useDocumentTitle(`${t("sessions.title")} · ${namespace}`)
  const s = useLaunchSession(namespace)

  return (
    <div>
      <SectionHeader
        micro={t("sessions.micro")}
        title={t("sessions.title")}
        description={
          <>
            {t("sessions.description")}{" "}
            <span dir="ltr" className="font-medium text-grid-fg">
              {namespace}
            </span>
          </>
        }
      />

      <SectionTitle>{t(s.result ? "sessions.ready" : "sessions.launch")}</SectionTitle>
      <section className="border-y border-line px-6 py-6">
        <div className="max-w-2xl">
          {s.result ? (
            <SessionResultView res={s.result} />
          ) : (
            <div className="space-y-3">
              <WriteToggle write={s.write} onChange={s.setWrite} />
              {s.error ? (
                <p role="alert" className="text-sm text-grid-danger-text">
                  {s.error}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>
      <div className="flex flex-wrap gap-2 px-6 py-6">
        {s.result ? (
          <Button variant="outline" onClick={s.reset}>
            <RotateCcwIcon className="rtl:-scale-x-100" /> {t("sessions.another")}
          </Button>
        ) : (
          <Button onClick={s.launch} disabled={s.busy}>
            <RocketIcon /> {s.busy ? t("sessions.minting") : t("sessions.mint")}
          </Button>
        )}
      </div>
    </div>
  )
}
