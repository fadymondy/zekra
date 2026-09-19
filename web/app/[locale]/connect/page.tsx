"use client"

// "Connect an agent": one MCP URL, then exact per-client steps with copyable snippets.
import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { CopyField } from "@/components/copy-field"
import { HatchBand, SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? "https://mcp.zekra.dev"

type Step = { text: ReactNode; snippet?: string }

function ClientRow({ name, steps }: { name: string; steps: Step[] }) {
  return (
    <section className="grid gap-3 border-b border-line px-6 py-5 md:grid-cols-[14rem_1fr] md:gap-6">
      <h2 className="text-sm font-medium text-grid-fg">{name}</h2>
      <ol className="min-w-0 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-grid-body">
            <span className="grid-micro mt-0.5 w-4 shrink-0 tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-2">
              <div>{s.text}</div>
              {s.snippet ? <CopyField value={s.snippet} /> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function ConnectPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(t("connect.title"))

  const cursor = JSON.stringify({ mcpServers: { zekra: { url: MCP_URL } } }, null, 2)
  const gemini = JSON.stringify({ mcpServers: { zekra: { httpUrl: MCP_URL } } }, null, 2)
  const urlStep: Step = { text: t("connect.urlLabel"), snippet: MCP_URL }

  const clients: { name: string; steps: Step[] }[] = [
    {
      name: t("connect.claude.name"),
      steps: [
        { text: t("connect.claude.s1") },
        { ...urlStep, text: t("connect.claude.s2") },
        { text: t("connect.claude.s3") },
        { text: t("connect.claude.s4") },
      ],
    },
    {
      name: t("connect.chatgpt.name"),
      steps: [
        { text: t("connect.chatgpt.s1") },
        { ...urlStep, text: t("connect.chatgpt.s2") },
        { text: t("connect.chatgpt.s3") },
        { text: t("connect.chatgpt.s4") },
      ],
    },
    {
      name: t("connect.claudeCode.name"),
      steps: [
        { text: t("connect.claudeCode.s1"), snippet: `claude mcp add --transport http zekra ${MCP_URL}` },
        { text: t("connect.claudeCode.s2") },
        { text: t("connect.or"), snippet: "zekra mcp:install claude-code --remote" },
      ],
    },
    {
      name: t("connect.cursor.name"),
      steps: [
        { text: t("connect.cursor.s1"), snippet: cursor },
        { text: t("connect.or"), snippet: "zekra mcp:install cursor --remote" },
      ],
    },
    {
      name: t("connect.gemini.name"),
      steps: [{ text: t("connect.gemini.s1"), snippet: gemini }],
    },
    {
      name: t("connect.stdio.name"),
      steps: [
        { text: t("connect.stdio.s1"), snippet: "curl -fsSL https://app.zekra.dev/install.sh | sh" },
        {
          text: (
            <>
              {t("connect.stdio.s2")}{" "}
              <span className="text-grid-muted">
                {t("connect.stdio.token")}{" "}
                <Link href={`/${locale}/brains`} className="text-grid-fg underline underline-offset-4">
                  {t("connect.stdio.openBrains")}
                </Link>
              </span>
            </>
          ),
          snippet: "zekra auth login --token <token>",
        },
        { text: t("connect.stdio.s3"), snippet: "zekra mcp:install codex" },
      ],
    },
  ]

  return (
    <div className="pb-10">
      <SectionHeader micro={t("connect.micro")} title={t("connect.title")} description={t("connect.description")} />

      <HatchBand>
        <p className="grid-micro mb-2">{t("connect.urlLabel")}</p>
        <CopyField value={MCP_URL} label={t("connect.urlLabel")} />
        <p className="mt-2 text-xs text-grid-muted">{t("connect.urlHint")}</p>
      </HatchBand>

      {clients.map((c) => (
        <ClientRow key={c.name} name={c.name} steps={c.steps} />
      ))}

      <p className="flex flex-wrap items-center gap-1.5 px-6 py-5 text-sm text-grid-muted">
        {t("connect.footer")}
        <Link
          href={`/${locale}/account/apps`}
          className="inline-flex items-center gap-1 text-grid-fg underline underline-offset-4"
        >
          {t("connect.footerLink")} <ArrowRightIcon className="size-3 rtl:-scale-x-100" />
        </Link>
      </p>
    </div>
  )
}
