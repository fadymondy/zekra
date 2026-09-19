import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"

import type { Block, ReportContent } from "@/lib/presentations/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EditScope, IfSet, Tx, TxMd } from "./edit"
import { Md } from "./markdown"
import { ReportChart } from "./report-chart"
import { ScreenView } from "./screen-view"
import { WorkflowView } from "./workflow-view"

/*
A long-form report (FM-344): cover, summary, a table of contents, then the
sections in order. Server-renderable except the charts.
*/
const TONES = {
  info: { icon: InfoIcon, className: "border-s-4 border-s-[var(--pres-series-1)]" },
  success: { icon: CircleCheckIcon, className: "border-s-4 border-s-[var(--pres-series-6)]" },
  warning: { icon: TriangleAlertIcon, className: "border-s-4 border-s-[var(--pres-series-4)]" },
  danger: { icon: CircleAlertIcon, className: "border-s-4 border-s-destructive" },
} as const

export function BlockView({ block, locale, dir }: { block: Block; locale: string; dir: "ltr" | "rtl" }) {
  switch (block.type) {
    case "markdown":
      return (
        <TxMd p="text" raw={block.text}>
          <Md className="leading-relaxed">{block.text}</Md>
        </TxMd>
      )
    case "table":
      return (
        <div className="my-5 overflow-x-auto rounded-lg border">
          <Table>
            {block.caption ? (
              <TableCaption className="pb-3">
                <Tx p="caption" v={block.caption} />
              </TableCaption>
            ) : null}
            <TableHeader>
              <TableRow>
                {block.columns.map((c, i) => (
                  <TableHead key={i}>
                    <Tx p={`columns.${i}`} v={c} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((r, i) => (
                <TableRow key={i}>
                  {block.columns.map((_, j) => (
                    <TableCell key={j} className="whitespace-normal">
                      <Tx p={`rows.${i}.${j}`} v={r[j] ?? ""} placeholder="—" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )
    case "callout": {
      const tone = TONES[block.tone] ?? TONES.info
      const Icon = tone.icon
      return (
        <Alert className={cn("my-5", tone.className)} variant={block.tone === "danger" ? "destructive" : "default"}>
          <Icon />
          <IfSet v={block.title}>
            <AlertTitle>
              <Tx p="title" v={block.title} />
            </AlertTitle>
          </IfSet>
          <AlertDescription>
            <TxMd p="text" raw={block.text}>
              <Md>{block.text}</Md>
            </TxMd>
          </AlertDescription>
        </Alert>
      )
    }
    case "chart":
      return <ReportChart block={block} locale={locale} dir={dir} />
    case "workflow":
      return <WorkflowView block={block} dir={dir} animate className="my-6 text-[0.9rem]" />
    case "screen":
      return <ScreenView block={block} dir={dir} animate className="my-6 text-[0.85rem]" />
  }
}

export function ReportView({
  content,
  locale,
  dir,
  preparedFor,
  labels,
}: {
  content: ReportContent
  locale: string
  dir: "ltr" | "rtl"
  preparedFor?: string
  labels: { summary: string; contents: string }
}) {
  return (
    <article dir={dir} className="pres-root mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="border-b pb-8">
        <div className="mb-6 h-1 w-16 rounded-full bg-brand" aria-hidden />
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          <Tx p="title" v={content.title} />
        </h1>
        <IfSet v={content.subtitle}>
          <p className="mt-2 text-lg text-muted-foreground">
            <Tx p="subtitle" v={content.subtitle} />
          </p>
        </IfSet>
        {preparedFor ? <p className="mt-4 text-sm text-muted-foreground">{preparedFor}</p> : null}
      </header>

      {content.sections.length > 1 ? (
        <nav aria-label={labels.contents} className="border-b py-6">
          <p className="mb-2 text-sm font-medium">{labels.contents}</p>
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            {content.sections.map((s, i) => (
              <li key={i}>
                <a href={`#section-${i + 1}`} className="hover:text-foreground hover:underline">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <IfSet v={content.summary}>
        <section className="border-b py-8">
          <h2 className="mb-3 text-xl font-semibold">{labels.summary}</h2>
          <TxMd p="summary" raw={content.summary}>
            <Md className="text-lg leading-relaxed">{content.summary}</Md>
          </TxMd>
        </section>
      </IfSet>

      {content.sections.map((s, i) => (
        <section key={i} id={`section-${i + 1}`} data-section={i} className="scroll-mt-20 py-8 [&+&]:border-t">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">
            <Tx p={`sections.${i}.heading`} v={s.heading} />
          </h2>
          <div className="space-y-4">
            {s.blocks.map((b, j) => (
              <EditScope key={j} at={`sections.${i}.blocks.${j}`}>
                <div data-block={`${i}.${j}`}>
                  <BlockView block={b} locale={locale} dir={dir} />
                </div>
              </EditScope>
            ))}
          </div>
        </section>
      ))}
    </article>
  )
}
