"use client"

import { Maximize2Icon, MinusIcon, PlusIcon } from "lucide-react"

import { useTranslations } from "@/lib/i18n"

const BTN = "flex size-8 items-center justify-center text-grid-muted hover:bg-grid-soft hover:text-grid-fg"

/** The graph's zoom stack and readout, pinned to the canvas's bottom-start corner. */
export function ZoomControls({
  zoomPct,
  onZoomIn,
  onZoomOut,
  onFit,
  fitLabel,
}: {
  zoomPct: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  fitLabel?: string
}) {
  const { t, formatNumber } = useTranslations()
  const fit = fitLabel ?? t("graph.fit")
  return (
    <>
      <div className="absolute bottom-3 start-3 z-20 flex flex-col overflow-hidden border border-line bg-grid-card">
        <button type="button" onClick={onZoomIn} className={BTN} title={t("graph.zoomIn")} aria-label={t("graph.zoomIn")}>
          <PlusIcon className="size-4" />
        </button>
        <button type="button" onClick={onZoomOut} className={`${BTN} border-t border-line`} title={t("graph.zoomOut")} aria-label={t("graph.zoomOut")}>
          <MinusIcon className="size-4" />
        </button>
        <button type="button" onClick={onFit} className={`${BTN} border-t border-line`} title={fit} aria-label={fit}>
          <Maximize2Icon className="size-4" />
        </button>
      </div>
      <div className="absolute bottom-3 start-14 z-20 border border-line bg-grid-card px-2 py-1 text-[11px] text-grid-muted">
        {formatNumber(zoomPct / 100, { style: "percent" })}
      </div>
    </>
  )
}
