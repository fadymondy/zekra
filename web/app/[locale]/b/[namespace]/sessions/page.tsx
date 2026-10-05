"use client"

import { Button } from "@fadymondy/nasaq/web"

import { useParams } from "next/navigation"
import { RocketIcon, RotateCcwIcon } from "lucide-react"

import { PageBody, Panel, SectionHeader } from "@/components/page"
import { SessionResultView, WriteToggle, useLaunchSession } from "@/components/sessions/launch-session"
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
            <span dir="ltr" className="font-medium text-foreground">
              {namespace}
            </span>
          </>
        }
      />

      <PageBody>
      <Panel title={t(s.result ? "sessions.ready" : "sessions.launch")}>
        <div className="max-w-2xl">
          {s.result ? (
            <SessionResultView res={s.result} />
          ) : (
            <div className="space-y-3">
              <WriteToggle write={s.write} onChange={s.setWrite} />
              {s.error ? (
                <p role="alert" className="text-sm text-nq-danger-text">
                  {s.error}
                </p>
              ) : null}
            </div>
          )}
        </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {s.result ? (
          <Button variant="secondary" onClick={s.reset}>
            <RotateCcwIcon className="rtl:-scale-x-100" /> {t("sessions.another")}
          </Button>
        ) : (
          <Button variant="primary" onClick={s.launch} disabled={s.busy}>
            <RocketIcon /> {s.busy ? t("sessions.minting") : t("sessions.mint")}
          </Button>
        )}
      </div>
      </Panel>
      </PageBody>
    </div>
  )
}
