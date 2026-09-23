"use client"

import { ClockIcon, CpuIcon, FileTextIcon, LayersIcon, RouteIcon, TriangleAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { ChatAnswer } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The answer's footprint (model, recalled count, latency, grounded) and its cited memories. */
export function Provenance({ answer, focusCite, idPrefix }: { answer: ChatAnswer; focusCite: number | null; idPrefix: string }) {
  const { t, formatNumber } = useTranslations()
  const fp = answer.footprint ?? ({} as Partial<ChatAnswer["footprint"]>)
  const citations = answer.citations ?? []
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="grid-micro inline-flex items-center gap-1.5">
          <RouteIcon className="size-3" /> {t("chat.tracedFrom")}
        </span>
        <Badge variant="outline" className="gap-1">
          <LayersIcon className="size-3" /> {t("chat.recalledCount", { n: formatNumber(fp.recalled ?? citations.length) })}
        </Badge>
        {fp.model ? (
          <Badge variant="outline" className="gap-1 font-mono" dir="ltr">
            <CpuIcon className="size-3" /> {fp.model}
          </Badge>
        ) : null}
        {typeof fp.latencyMs === "number" ? (
          <Badge variant="outline" className="gap-1">
            <ClockIcon className="size-3" /> {t("chat.seconds", { n: formatNumber(fp.latencyMs / 1000, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })}
          </Badge>
        ) : null}
        {fp.grounded === false ? (
          <Badge variant="outline" className="gap-1 text-grid-warn">
            <TriangleAlertIcon className="size-3" /> {t("chat.ungrounded")}
          </Badge>
        ) : fp.grounded ? (
          <Badge variant="outline" className="gap-1 text-grid-ok">{t("chat.grounded")}</Badge>
        ) : null}
      </div>
      {citations.length > 0 ? (
        <Collapsible defaultOpen className="border border-line">
          <CollapsibleTrigger className="grid-micro w-full cursor-pointer px-3 py-2 text-start">
            {t(citations.length === 1 ? "chat.citedOne" : "chat.citedMany", { n: formatNumber(citations.length) })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="divide-y divide-line border-t border-line">
              {citations.map((c, i) => (
                <li
                  key={`${c.id}-${i}`}
                  id={`${idPrefix}-cite-${i + 1}`}
                  className={cn("p-3 text-xs transition-colors", focusCite === i + 1 && "border-s-2 border-s-grid-action bg-grid-soft")}
                >
                  <div className="mb-1.5 flex items-center gap-2 text-grid-muted">
                    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center bg-grid-soft px-1 font-mono text-[12px] leading-none text-grid-action">{i + 1}</span>
                    <FileTextIcon className="size-3 shrink-0" />
                    <span dir="ltr" className="font-mono">
                      {c.network}·{c.memoryType}
                    </span>
                    {c.sourceKind ? (
                      <span dir="ltr" className="truncate font-mono">
                        {c.sourceKind}
                        {c.sourceRef ? `/${c.sourceRef}` : ""}
                      </span>
                    ) : null}
                    <span className="ms-auto shrink-0 font-mono">{t("chat.score", { n: formatNumber(c.score, { maximumFractionDigits: 3, minimumFractionDigits: 3 }) })}</span>
                  </div>
                  <div dir="auto" className="whitespace-pre-wrap text-grid-fg">
                    {c.content}
                  </div>
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
