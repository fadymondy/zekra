"use client"

import { useState } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { useTranslations } from "@/lib/i18n"
import type { ChartBlock } from "@/lib/presentations/types"
import { seriesDrawOrder } from "@/lib/presentations/workflow"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/*
A report chart (FM-344), per the dataviz skill:
  - one y-axis, always; thin marks (bars ≤24px with a 4px data-end, 2px lines);
  - series colours in FIXED slot order from the validated palette
    (--pres-series-1…6, presentations.css), never cycled — a 7th series is
    dropped from the plot and stays in the table;
  - a legend whenever there are ≥2 series, a hover tooltip, recessive grid;
  - a table view one click away (required: slots 3–5 are under 3:1 on the
    light surface, so values must be readable without colour).
*/
export const MAX_SERIES = 6

export function chartConfig(block: ChartBlock): ChartConfig {
  const config: ChartConfig = {}
  block.series.slice(0, MAX_SERIES).forEach((s, i) => {
    config[`s${i}`] = { label: s.name, color: `var(--pres-series-${i + 1})` }
  })
  return config
}

export function chartRows(block: ChartBlock): Record<string, string | number>[] {
  return block.labels.map((label, i) => {
    const row: Record<string, string | number> = { label }
    block.series.slice(0, MAX_SERIES).forEach((s, si) => {
      if (typeof s.values[i] === "number") row[`s${si}`] = s.values[i]
    })
    return row
  })
}

export function ReportChart({ block, locale, dir }: { block: ChartBlock; locale: string; dir: "ltr" | "rtl" }) {
  const { t } = useTranslations()
  const [table, setTable] = useState(false)
  const config = chartConfig(block)
  const rows = chartRows(block)
  const keys = Object.keys(config)
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 2 })
  const tick = (v: number) => `${nf.format(v)}${block.unit ?? ""}`
  const rtl = dir === "rtl"
  /*
  RTL: groups run right-to-left (reversed x-axis), so the series inside a group
  must too, and the legend reads from the right in the same order. Recharts
  draws grouped bars in child order, left to right, so the children are
  reversed; the legend and tooltip are re-sorted by series slot, never by
  render order, so colour and position still follow the entity.
  */
  const drawKeys = seriesDrawOrder(keys, rtl, block.chart)
  const bySlot = <T extends { dataKey?: unknown }>(items?: readonly T[]) =>
    [...(items ?? [])].sort((a, b) => keys.indexOf(String(a.dataKey)) - keys.indexOf(String(b.dataKey)))
  const axes = (
    <>
      <CartesianGrid vertical={false} strokeOpacity={0.5} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} reversed={rtl} />
      <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => nf.format(v)} orientation={rtl ? "right" : "left"} />
      <ChartTooltip itemSorter={(item) => keys.indexOf(String(item.dataKey))} content={<ChartTooltipContent formatter={(v, name) => `${config[String(name)]?.label ?? name}: ${tick(Number(v))}`} />} />
      {keys.length > 1 ? (
        <ChartLegend
          content={({ payload, verticalAlign }) => (
            <div dir={dir} data-legend-dir={dir}>
              <ChartLegendContent payload={bySlot(payload)} verticalAlign={verticalAlign} />
            </div>
          )}
        />
      ) : null}
    </>
  )

  return (
    <figure className="my-6 rounded-xl border p-4" data-chart={block.chart}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {block.title || block.unit ? (
          <figcaption className="font-medium">
            {block.title}
            {block.unit?.trim() ? <span className="ms-1 font-normal text-muted-foreground">({block.unit.trim()})</span> : null}
          </figcaption>
        ) : (
          <span />
        )}
        <Button variant="outline" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? t("presentations.chart.showChart") : t("presentations.chart.showTable")}
        </Button>
      </div>
      {table ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              {block.series.map((s, i) => (
                <TableHead key={i}>{s.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.labels.map((l, i) => (
              <TableRow key={i}>
                <TableHead scope="row">{l}</TableHead>
                {block.series.map((s, si) => (
                  <TableCell key={si} className="tabular-nums">
                    <bdi>{typeof s.values[i] === "number" ? tick(s.values[i]) : ""}</bdi>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-72 w-full" dir="ltr">
          {block.chart === "line" ? (
            <LineChart data={rows} margin={{ left: 4, right: 12, top: 8 }}>
              {axes}
              {keys.map((k) => (
                <Line key={k} dataKey={k} type="monotone" stroke={`var(--color-${k})`} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          ) : block.chart === "area" ? (
            <AreaChart data={rows} margin={{ left: 4, right: 12, top: 8 }}>
              {axes}
              {keys.map((k) => (
                <Area key={k} dataKey={k} type="monotone" stroke={`var(--color-${k})`} fill={`var(--color-${k})`} fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={rows} margin={{ left: 4, right: 12, top: 8 }} barGap={2} maxBarSize={24}>
              {axes}
              {drawKeys.map((k) => (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={`var(--color-${k})`}
                  stackId={block.chart === "stacked_bar" ? "stack" : undefined}
                  radius={block.chart === "stacked_bar" ? (k === keys[keys.length - 1] ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
                  stroke={block.chart === "stacked_bar" ? "var(--card)" : undefined}
                  strokeWidth={block.chart === "stacked_bar" ? 2 : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ChartContainer>
      )}
      {block.caption ? <p className="mt-2 text-sm text-muted-foreground">{block.caption}</p> : null}
    </figure>
  )
}
