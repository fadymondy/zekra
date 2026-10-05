"use client"

import { Badge } from "@fadymondy/nasaq/web"

import useSWR from "swr"

import { PageBody, Panel, SectionHeader, StatStrip } from "@/components/page"
import { Ltr } from "@/components/copy-field"
import { ErrorState, LoadingRows } from "@/components/states"
import { api, brainApi } from "@/lib/api"
import { parseMethods, PROVIDER_NAMES, PROVIDERS } from "@/lib/auth"
import { useTranslations } from "@/lib/i18n"
import { noRetryOn4xx } from "@/lib/queries"
import { useLiveStatus } from "@/lib/realtime"
import { useDocumentTitle } from "@/lib/title"

export default function AdminSettingsPage() {
  const { t, formatNumber } = useTranslations()
  useDocumentTitle(t("admin.settings.title"))
  const live = useLiveStatus()

  const ping = useSWR(
    "/api/brain/ping",
    async () => {
      const started = performance.now()
      const r = await brainApi.ping()
      return { ...r, ms: Math.round(performance.now() - started) }
    },
    { ...noRetryOn4xx, refreshInterval: 30_000 },
  )
  const methods = useSWR("/api/auth/methods", () => api<unknown>("/api/auth/methods"), noRetryOn4xx)
  const parsed = methods.data !== undefined ? parseMethods(methods.data) : undefined
  const version = process.env.NEXT_PUBLIC_APP_VERSION

  const yesNo = (v: boolean | undefined) => (v === undefined ? "—" : v ? t("admin.settings.on") : t("admin.settings.off"))

  return (
    <>
      <SectionHeader micro={t("admin.micro")} title={t("admin.settings.title")} description={t("admin.settings.hint")} />
      <PageBody>

      <Panel title={t("admin.settings.api")}>
      {ping.error ? (
        <ErrorState error={ping.error} />
      ) : !ping.data ? (
        <LoadingRows rows={1} />
      ) : (
        <StatStrip
          items={[
            {
              label: t("admin.settings.status"),
              value: (
                <Badge variant={ping.data.status === "ok" ? "success" : "danger"}>
                  {ping.data.status === "ok" ? t("admin.settings.healthy") : <Ltr>{ping.data.status}</Ltr>}
                </Badge>
              ),
            },
            { label: t("admin.settings.plugin"), value: <Ltr mono>{ping.data.plugin}</Ltr> },
            { label: t("admin.settings.latency"), value: t("admin.activity.ms", { n: formatNumber(ping.data.ms) }) },
            { label: t("admin.settings.authRequired"), value: yesNo(ping.data.authRequired) },
          ]}
        />
      )}

      </Panel>

      <Panel title={t("admin.settings.auth")}>
      {methods.error ? (
        <ErrorState error={methods.error} />
      ) : !parsed ? (
        <LoadingRows rows={1} />
      ) : (
        <ul className="-mx-2 flex flex-col gap-1">
          <MethodRow label={t("admin.settings.password")} on={parsed.password} />
          <MethodRow label={t("admin.settings.emailCode")} on={parsed.code} />
          {PROVIDERS.map((p) => (
            <MethodRow key={p} label={PROVIDER_NAMES[p]} ltr on={!!parsed.providers[p]} />
          ))}
        </ul>
      )}

      </Panel>

      <Panel title={t("admin.settings.console")}>
      <StatStrip
        items={[
          { label: t("admin.settings.version"), value: version ? <Ltr mono>{version}</Ltr> : "—" },
          {
            label: t("admin.settings.realtime"),
            value: (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-2 rounded-full ${live === "live" ? "bg-emerald-500" : live === "connecting" ? "bg-amber-500" : "bg-muted-foreground"}`}
                />
                {t(`shell.live.${live}`)}
              </span>
            ),
          },
          { label: t("admin.settings.stream"), value: <Ltr mono>/api/brain/events</Ltr> },
        ]}
      />
      </Panel>
      </PageBody>
    </>
  )
}

function MethodRow({ label, on, ltr }: { label: string; on: boolean; ltr?: boolean }) {
  const { t } = useTranslations()
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-nq-hover">
      <span className="flex-1 text-foreground">
        {ltr ? <Ltr>{label}</Ltr> : label}
      </span>
      <Badge variant={on ? "success" : "outline"}>{on ? t("admin.settings.enabled") : t("admin.settings.disabled")}</Badge>
    </li>
  )
}
