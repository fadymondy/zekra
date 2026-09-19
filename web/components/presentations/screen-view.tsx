"use client"

import { useEffect, useRef } from "react"
import { BatteryFullIcon, SignalHighIcon, WifiIcon } from "lucide-react"
import { ArrowDownIcon, ArrowUpIcon, CircleAlertIcon, CircleCheckIcon, CalendarIcon, ChevronDownIcon, InfoIcon, MinusIcon, PaperclipIcon, TriangleAlertIcon } from "lucide-react"
import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, XAxis } from "recharts"
import { cn } from "cn"

import { reveal, whenVisible } from "@/lib/presentations/motion"
import type { ScreenBlock, ScreenPart, Tone } from "@/lib/presentations/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EditScope, Tx, useEditing } from "./edit"
import { PresIcon } from "./icon"
import { MapView } from "./map-view"

/*
A product-screen mockup (FM-350), declared as data and drawn with the site's
own components inside a device frame: browser (address bar), app (window
title bar) or tablet (bezel). Parts sit in a container-query grid, so the
same screen reads on a phone, in a slide and in a report. Annotations are
numbered markers on their parts plus a numbered legend under the frame.
With `animate`: frame, then parts, then annotations.
*/

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-[var(--pres-series-1)]/40 bg-[var(--pres-series-1)]/10 text-[var(--pres-series-1)]",
  success: "border-[var(--pres-series-6)]/40 bg-[var(--pres-series-6)]/10 text-[var(--pres-series-6)]",
  warning: "border-[var(--pres-series-4)]/50 bg-[var(--pres-series-4)]/10 text-foreground",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
}

function Status({ text, tone, p }: { text?: string; tone?: Tone; p?: string }) {
  if (!text) return null
  return (
    <Badge variant="outline" className={cn("h-auto px-[0.5em] py-[0.1em] text-[0.86em] font-medium", TONE_CLASS[tone ?? "neutral"])}>
      {p ? <Tx p={p} v={text} /> : text}
    </Badge>
  )
}

const WIDE = new Set(["kpis", "table", "board", "split", "callout", "map"])

function PartTitle({ title }: { title?: string }) {
  return title ? (
    <p className="mb-[0.5em] text-[0.8em] font-semibold tracking-wide text-muted-foreground uppercase">
      <Tx p="title" v={title} />
    </p>
  ) : null
}

function Part({ part, phone = false, dir = "ltr" }: { part: ScreenPart; phone?: boolean; dir?: "ltr" | "rtl" }) {
  switch (part.type) {
    case "map":
      return <MapView part={part} dir={dir} portrait={phone} />
    case "kpis":
      return (
        <div className="grid gap-[0.6em]" style={{ gridTemplateColumns: phone ? "repeat(2, minmax(0, 1fr))" : `repeat(auto-fit, minmax(min(100%, 9em), 1fr))` }}>
          {part.items.map((k, i) => (
            <div key={i} className="rounded-[0.6em] border bg-card p-[0.7em]">
              <div className="flex items-center justify-between gap-2 text-[0.84em] text-muted-foreground">
                <span className="truncate">
                  <Tx p={`items.${i}.label`} v={k.label} />
                </span>
                <PresIcon name={k.icon} className="size-[1.1em] shrink-0 text-brand" />
              </div>
              <div className="mt-[0.2em] text-[1.45em] font-semibold tabular-nums">
                <bdi>
                  <Tx p={`items.${i}.value`} v={k.value} />
                </bdi>
              </div>
              {k.delta ? (
                <div className="flex items-center gap-1 text-[0.75em] text-muted-foreground">
                  {k.trend === "up" ? <ArrowUpIcon className="size-[1em]" aria-hidden /> : k.trend === "down" ? <ArrowDownIcon className="size-[1em]" aria-hidden /> : <MinusIcon className="size-[1em]" aria-hidden />}
                  <bdi>
                    <Tx p={`items.${i}.delta`} v={k.delta} />
                  </bdi>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )
    case "table": {
      const hasStatus = part.rows.some((r) => r.status)
      if (phone) {
        // On a phone a table reads as a stack of cards: the first cell leads, the rest follow as label: value.
        return (
          <div>
            <PartTitle title={part.title} />
            <div className="grid gap-[0.5em]">
              {part.rows.map((r, i) => (
                <div key={i} data-row className="rounded-[0.6em] border bg-card p-[0.65em]">
                  <div className="flex items-center justify-between gap-[0.5em]">
                    <span className="min-w-0 truncate font-semibold">
                      <Tx p={`rows.${i}.cells.0`} v={r.cells[0] ?? ""} />
                    </span>
                    <Status text={r.status} tone={r.tone} p={`rows.${i}.status`} />
                  </div>
                  {part.columns.slice(1).map((c, j) =>
                    r.cells[j + 1] ? (
                      <div key={j} className="mt-[0.15em] flex justify-between gap-[0.5em] text-[0.85em]">
                        <span className="text-muted-foreground">
                          <Tx p={`columns.${j + 1}`} v={c} />
                        </span>
                        <span className="min-w-0 truncate">
                          <Tx p={`rows.${i}.cells.${j + 1}`} v={r.cells[j + 1]} />
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      }
      return (
        <div>
          <PartTitle title={part.title} />
          <div className="overflow-hidden rounded-[0.6em] border bg-card">
            <Table className="text-[0.88em]">
              <TableHeader>
                <TableRow>
                  {part.columns.map((c, i) => (
                    <TableHead key={i} className="h-[2.4em]">
                      <Tx p={`columns.${i}`} v={c} />
                    </TableHead>
                  ))}
                  {hasStatus ? <TableHead className="h-[2.4em]" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {part.rows.map((r, i) => (
                  <TableRow key={i}>
                    {part.columns.map((_, j) => (
                      <TableCell key={j} className="py-[0.5em] whitespace-normal">
                        <Tx p={`rows.${i}.cells.${j}`} v={r.cells[j] ?? ""} placeholder="—" />
                      </TableCell>
                    ))}
                    {hasStatus ? (
                      <TableCell className="py-[0.5em]">
                        <Status text={r.status} tone={r.tone} p={`rows.${i}.status`} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )
    }
    case "form":
      return (
        <div className="rounded-[0.6em] border bg-card p-[0.8em]">
          <PartTitle title={part.title} />
          <div className="grid gap-[0.6em]">
            {part.fields.map((f, i) => {
              const Icon = f.type === "date" ? CalendarIcon : f.type === "select" ? ChevronDownIcon : f.type === "file" ? PaperclipIcon : null
              const StateIcon = f.state === "ok" ? CircleCheckIcon : f.state === "missing" ? CircleAlertIcon : f.state === "warning" ? TriangleAlertIcon : null
              return (
                <div key={i} className="grid gap-[0.25em]">
                  <span className="text-[0.84em] font-medium">
                    <Tx p={`fields.${i}.label`} v={f.label} />
                  </span>
                  <div
                    className={cn(
                      "flex h-[2.3em] items-center gap-[0.4em] rounded-[0.45em] border bg-background px-[0.6em] text-[0.82em]",
                      f.state === "missing" && "border-destructive/60",
                      f.state === "warning" && "border-[var(--pres-series-4)]",
                    )}
                  >
                    <span className={cn("min-w-0 flex-1 truncate", !f.value && "text-muted-foreground")}>
                      <bdi>
                        <EditOr p={`fields.${i}.value`} v={f.value} empty="—" />
                      </bdi>
                    </span>
                    {Icon ? <Icon className="size-[1em] text-muted-foreground" aria-hidden /> : null}
                    {StateIcon ? (
                      <StateIcon
                        aria-hidden
                        className={cn(
                          "size-[1.05em]",
                          f.state === "ok" && "text-[var(--pres-series-6)]",
                          f.state === "missing" && "text-destructive",
                          f.state === "warning" && "text-[var(--pres-series-4)]",
                        )}
                      />
                    ) : null}
                  </div>
                  {f.hint ? (
                    <span className="text-[0.72em] text-muted-foreground">
                      <Tx p={`fields.${i}.hint`} v={f.hint} />
                    </span>
                  ) : null}
                </div>
              )
            })}
            {part.submit_label ? (
              <Button size="sm" className="mt-[0.2em] h-auto justify-self-start px-[0.8em] py-[0.35em] text-[0.85em]" tabIndex={-1} aria-disabled>
                <Tx p="submit_label" v={part.submit_label} />
              </Button>
            ) : null}
          </div>
        </div>
      )
    case "chart": {
      const config: ChartConfig = {}
      part.series.forEach((s, i) => (config[`s${i}`] = { label: s.name, color: `var(--pres-series-${i + 1})` }))
      const rows = part.labels.map((label, i) => {
        const row: Record<string, string | number> = { label }
        part.series.forEach((s, si) => (row[`s${si}`] = s.values[i] ?? 0))
        return row
      })
      return (
        <div className="rounded-[0.6em] border bg-card p-[0.8em]">
          <PartTitle title={part.title} />
          <ChartContainer config={config} className="aspect-auto h-[9em] w-full text-[0.75em]" dir="ltr">
            {part.chart === "donut" ? (
              <PieChart>
                <Pie data={rows.map((r, i) => ({ name: r.label, value: Number(r.s0) || 0, fill: `var(--pres-series-${(i % 6) + 1})` }))} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
                  {rows.map((_, i) => (
                    <Cell key={i} fill={`var(--pres-series-${(i % 6) + 1})`} />
                  ))}
                </Pie>
              </PieChart>
            ) : part.chart === "line" ? (
              <LineChart data={rows} margin={{ left: 4, right: 4, top: 6 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize="1em" />
                {part.series.map((_, i) => (
                  <Line key={i} dataKey={`s${i}`} stroke={`var(--color-s${i})`} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={rows} margin={{ left: 4, right: 4, top: 6 }} barGap={2} maxBarSize={18}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize="1em" />
                {part.series.map((_, i) => (
                  <Bar key={i} dataKey={`s${i}`} fill={`var(--color-s${i})`} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            )}
          </ChartContainer>
          {part.chart === "donut" || part.series.length > 1 ? (
            <ul className="mt-[0.4em] flex flex-wrap gap-x-[0.8em] gap-y-[0.2em] text-[0.72em] text-muted-foreground">
              {(part.chart === "donut" ? part.labels : part.series.map((s) => s.name)).map((name, i) => (
                <li key={i} className="flex items-center gap-[0.3em]">
                  <span className="size-[0.6em] rounded-[2px]" style={{ background: `var(--pres-series-${(i % 6) + 1})` }} aria-hidden />
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )
    }
    case "list":
    case "timeline":
      return (
        <div className="rounded-[0.6em] border bg-card p-[0.8em]">
          <PartTitle title={part.title} />
          <ol className={cn("grid gap-[0.55em]", part.type === "timeline" && "relative ms-[0.55em] border-s ps-[1em]")}>
            {part.items.map((it, i) => (
              <li key={i} className="relative flex items-start gap-[0.55em]">
                {part.type === "timeline" ? (
                  <span className="absolute -start-[1.33em] top-[0.35em] size-[0.65em] rounded-full border-2 border-background bg-brand" aria-hidden />
                ) : (
                  <span className="flex size-[1.9em] shrink-0 items-center justify-center rounded-[0.45em] border bg-muted text-brand">
                    <PresIcon name={it.icon ?? "check"} className="size-[1em]" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[0.85em] font-medium leading-tight">
                    <Tx p={`items.${i}.title`} v={it.title} list={{ path: "items", index: i }} />
                  </div>
                  {it.meta ? (
                    <div className="text-[0.72em] text-muted-foreground">
                      <Tx p={`items.${i}.meta`} v={it.meta} />
                    </div>
                  ) : null}
                </div>
                <Status text={it.status} tone={it.tone} p={`items.${i}.status`} />
              </li>
            ))}
          </ol>
        </div>
      )
    case "board":
      return (
        <div>
          <PartTitle title={part.title} />
          <div className="grid gap-[0.6em]" style={{ gridTemplateColumns: `repeat(${part.columns.length}, minmax(8em, 1fr))`, overflowX: "auto" }}>
            {part.columns.map((col, i) => (
              <div key={i} className="rounded-[0.6em] bg-muted/60 p-[0.5em]">
                <div className="mb-[0.4em] flex items-center justify-between text-[0.84em] font-semibold">
                  <span>
                    <Tx p={`columns.${i}.title`} v={col.title} />
                  </span>
                  <span className="text-muted-foreground tabular-nums">{col.cards?.length ?? 0}</span>
                </div>
                <div className="grid gap-[0.4em]">
                  {(col.cards ?? []).map((c, j) => (
                    <div key={j} className={cn("rounded-[0.45em] border bg-card p-[0.5em] text-[0.84em]", c.tone && c.tone !== "neutral" && "border-s-[3px]", c.tone && TONE_CLASS[c.tone].split(" ")[0])}>
                      <div className="flex items-center gap-[0.35em] font-medium">
                        <PresIcon name={c.icon} className="size-[1em] text-brand" />
                        <span className="min-w-0">
                          <Tx p={`columns.${i}.cards.${j}.title`} v={c.title} />
                        </span>
                      </div>
                      {c.meta ? (
                        <div className="mt-[0.15em] text-muted-foreground">
                          <Tx p={`columns.${i}.cards.${j}.meta`} v={c.meta} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    case "split":
      return (
        <div className="grid gap-[0.8em] @lg/screen:grid-cols-2">
          {(["left", "right"] as const).map((sideKey) => (
            <div key={sideKey} className="grid content-start gap-[0.6em] rounded-[0.7em] border border-dashed p-[0.6em]">
              {(sideKey === "left" ? part.left_label : part.right_label) ? (
                <Badge variant={sideKey === "left" ? "outline" : "default"} className="justify-self-start">
                  <Tx p={`${sideKey}_label`} v={sideKey === "left" ? part.left_label : part.right_label} />
                </Badge>
              ) : null}
              {part[sideKey].map((p, i) => (
                <EditScope key={i} at={`${sideKey}.${i}`}>
                  <Part part={p} phone={phone} dir={dir} />
                </EditScope>
              ))}
            </div>
          ))}
        </div>
      )
    case "callout": {
      const Icon = part.tone === "success" ? CircleCheckIcon : part.tone === "warning" ? TriangleAlertIcon : part.tone === "danger" ? CircleAlertIcon : InfoIcon
      return (
        <div className={cn("flex gap-[0.6em] rounded-[0.6em] border p-[0.7em] text-[0.85em]", TONE_CLASS[part.tone])}>
          <Icon className="mt-[0.1em] size-[1.1em] shrink-0" aria-hidden />
          <div className="min-w-0 text-foreground">
            {part.title ? (
              <div className="font-semibold">
                <Tx p="title" v={part.title} />
              </div>
            ) : null}
            <div className="text-muted-foreground">
              <Tx p="text" v={part.text} />
            </div>
          </div>
        </div>
      )
    }
    case "image":
      return (
        <figure className="overflow-hidden rounded-[0.6em] border bg-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- validated http(s) or site path */}
          <img src={part.url} alt={part.alt} className="aspect-video w-full object-cover" loading="lazy" />
          {part.caption ? (
            <figcaption className="p-[0.5em] text-[0.75em] text-muted-foreground">
              <Tx p="caption" v={part.caption} />
            </figcaption>
          ) : null}
        </figure>
      )
  }
}

/** A value that shows a dash when empty for readers, and an empty field in the editor. */
function EditOr({ p, v, empty }: { p: string; v?: string; empty: string }) {
  const editing = useEditing()
  return editing ? <Tx p={p} v={v} placeholder={empty} /> : <>{v || empty}</>
}

function Marker({ n }: { n: number }) {
  return (
    <span className="flex size-[1.7em] shrink-0 items-center justify-center rounded-full bg-brand text-[0.85em] font-bold text-white tabular-nums shadow-sm ring-2 ring-background">
      {n}
    </span>
  )
}

export function ScreenView({
  block,
  dir,
  animate = false,
  compact = false,
  className,
}: {
  block: ScreenBlock
  dir: "ltr" | "rtl"
  animate?: boolean
  /** Inside a slide: no title/caption, the legend beside the frame when there is room. */
  compact?: boolean
  className?: string
}) {
  const root = useRef<HTMLElement>(null)
  const focus = typeof block.focus === "number" && block.focus >= 0 && block.focus < block.parts.length ? block.focus : undefined
  useEffect(() => {
    if (!animate || !root.current) return
    const el = root.current
    return whenVisible(el, () => reveal(el, { step: 80 }))
  }, [animate])

  if (block.frame === "app") return <PhoneScreen block={block} dir={dir} animate={animate} compact={compact} className={className} />

  const notes = new Map<number, number[]>()
  ;(block.annotations ?? []).forEach((a, i) => notes.set(a.target_part_index, [...(notes.get(a.target_part_index) ?? []), i + 1]))
  const nav = block.nav ?? []
  const layout = nav.length ? (block.layout ?? "none") : "none"

  const frameTop =
    block.frame === "browser" ? (
      <div className="flex items-center gap-[0.6em] border-b bg-muted/70 px-[0.8em] py-[0.5em]" dir="ltr">
        <span className="flex gap-[0.35em]" aria-hidden>
          <i className="size-[0.65em] rounded-full bg-[#ff5f57]" />
          <i className="size-[0.65em] rounded-full bg-[#febc2e]" />
          <i className="size-[0.65em] rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto flex min-w-0 max-w-[70%] flex-1 items-center justify-center truncate rounded-full border bg-background px-[0.9em] py-[0.15em] text-[0.84em] text-muted-foreground">
          {block.url || block.screen_title || ""}
        </span>
        <span className="w-[2.3em]" aria-hidden />
      </div>
    ) : block.frame === "desktop" ? (
      // A desktop app window: window buttons and the app's name, no address bar.
      <div className="flex items-center gap-[0.6em] border-b bg-muted/70 px-[0.8em] py-[0.45em]" dir="ltr" data-title-bar>
        <span className="flex gap-[0.35em]" aria-hidden>
          <i className="size-[0.65em] rounded-full bg-[#ff5f57]" />
          <i className="size-[0.65em] rounded-full bg-[#febc2e]" />
          <i className="size-[0.65em] rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto truncate text-[0.82em] font-semibold" dir={dir}>
          {block.screen_title || block.url || ""}
        </span>
        <span className="w-[2.3em]" aria-hidden />
      </div>
    ) : block.frame === "tablet" ? (
      // A landscape tablet: a status bar across the top.
      <div className="flex items-center justify-between px-[1.2em] pt-[0.45em] pb-[0.25em] text-[0.84em] font-semibold" dir="ltr" data-status-bar>
        <span className="tabular-nums">9:41</span>
        <span className="flex items-center gap-[0.35em]" aria-hidden>
          <WifiIcon className="size-[1em]" />
          <BatteryFullIcon className="size-[1.2em]" />
        </span>
      </div>
    ) : null

  return (
    <figure ref={root} className={cn("pres-screen @container/screenfig w-full", className)} dir={dir} data-focus={focus}>
      {!compact && block.title ? (
        <figcaption className="pres-heading mb-[0.6em] text-[1.4em] font-semibold">
          <Tx p="title" v={block.title} />
        </figcaption>
      ) : null}
      <div className="relative grid gap-[1em]">
        <div
          data-reveal
          className={cn(
            "@container/screen overflow-hidden border bg-background text-foreground shadow-lg",
            block.frame === "tablet" ? "rounded-[2em] border-[0.9em] border-foreground/90 shadow-2xl" : "rounded-[0.8em]",
          )}
          data-frame={block.frame}
          // A landscape tablet keeps its shape and grows if the content is taller.
          style={block.frame === "tablet" ? { aspectRatio: "1180 / 820" } : undefined}
        >
          {frameTop}
          <div className={cn("flex min-h-0 flex-col", layout === "sidebar" && "@md/screen:flex-row")}>
            {layout === "sidebar" ? (
              <nav className="hidden w-[11em] shrink-0 flex-col gap-[0.15em] border-e bg-muted/40 p-[0.6em] @md/screen:flex">
                {block.screen_title ? (
                  <div className="mb-[0.4em] px-[0.4em] text-[0.8em] font-semibold">
                    <Tx p="screen_title" v={block.screen_title} />
                  </div>
                ) : null}
                {nav.map((n, i) => (
                  <span key={i} className={cn("flex items-center gap-[0.5em] rounded-[0.45em] px-[0.5em] py-[0.35em] text-[0.86em]", n.active ? "bg-background font-medium shadow-xs" : "text-muted-foreground")}>
                    <PresIcon name={n.icon} className="size-[1em]" />
                    <span className="truncate">
                      <Tx p={`nav.${i}.label`} v={n.label} />
                    </span>
                  </span>
                ))}
              </nav>
            ) : null}
            {layout === "topbar" || (layout === "sidebar" && nav.length) ? (
              <nav className={cn("flex gap-[0.2em] overflow-x-auto border-b px-[0.6em] py-[0.35em]", layout === "sidebar" && "@md/screen:hidden")}>
                {nav.map((n, i) => (
                  <span key={i} className={cn("flex shrink-0 items-center gap-[0.35em] rounded-[0.45em] px-[0.5em] py-[0.25em] text-[0.86em]", n.active ? "bg-muted font-medium" : "text-muted-foreground")}>
                    <PresIcon name={n.icon} className="size-[1em]" />
                    <Tx p={`nav.${i}.label`} v={n.label} />
                  </span>
                ))}
              </nav>
            ) : null}
            <div className="grid min-w-0 flex-1 content-start gap-[0.8em] bg-muted/20 p-[0.9em] @xl/screen:grid-cols-2">
              {block.parts.map((p, i) => (
                <div
                  key={i}
                  data-reveal
                  data-part={i}
                  className={cn(
                    "relative min-w-0",
                    (WIDE.has(p.type) || i === focus) && "@xl/screen:col-span-2",
                    focus !== undefined &&
                      (i === focus
                        ? "z-10 rounded-[0.7em] shadow-2xl ring-2 ring-brand ring-offset-4 ring-offset-background"
                        : "[&>*:not(.pres-marks)]:opacity-40 [&>*:not(.pres-marks)]:saturate-50"),
                  )}
                >
                  <EditScope at={`parts.${i}`}>
                    <Part part={p} dir={dir} />
                  </EditScope>
                  {notes.has(i) ? (
                    <span className="pres-marks absolute -end-[0.35em] -top-[0.55em] z-10 flex gap-[0.2em]">
                      {notes.get(i)!.map((n) => (
                        <Marker key={n} n={n} />
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        {block.annotations?.length ? (
          <ol
            data-notes
            className={cn(
              "grid content-start gap-[0.5em]",
              // On a wide slide the notes float over the frame's corner instead of taking a column.
              compact &&
                "@3xl/screenfig:absolute @3xl/screenfig:end-[1em] @3xl/screenfig:bottom-[1em] @3xl/screenfig:z-20 @3xl/screenfig:max-w-[24em] @3xl/screenfig:rounded-[0.7em] @3xl/screenfig:border @3xl/screenfig:bg-background/95 @3xl/screenfig:p-[0.8em] @3xl/screenfig:shadow-xl @3xl/screenfig:backdrop-blur",
            )}
          >
            {block.annotations.map((a, i) => (
              <li key={i} data-reveal className="flex items-start gap-[0.5em] text-[0.92em]">
                <Marker n={i + 1} />
                <span className="pt-[0.1em]">
                  <Tx p={`annotations.${i}.text`} v={a.text} />
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      {!compact && block.caption ? (
        <p className="mt-[0.6em] text-[0.85em] text-muted-foreground">
          <Tx p="caption" v={block.caption} />
        </p>
      ) : null}
    </figure>
  )
}

/*
frame: "app" (production finding): a portrait phone — status bar, the app's
header (screen_title), the parts stacked as on a phone, the nav as a bottom tab
bar, a home indicator. It is 17em wide at a 390:780 ratio, so its size follows
the font size the host sets (see .pres-phone-host in presentations.css).
Annotations sit beside the phone when there is room, numbered on their parts.
`notes: false` leaves them to the host (a deck slide lists them by the title).
*/
export function PhoneScreen({
  block,
  dir,
  animate = false,
  compact = false,
  className,
  notes: showNotes = true,
}: {
  block: ScreenBlock
  dir: "ltr" | "rtl"
  animate?: boolean
  compact?: boolean
  className?: string
  notes?: boolean
}) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!animate || !root.current) return
    const el = root.current
    return whenVisible(el, () => reveal(el, { step: 80 }))
  }, [animate])
  const focus = typeof block.focus === "number" && block.focus >= 0 && block.focus < block.parts.length ? block.focus : undefined
  const marks = new Map<number, number[]>()
  ;(block.annotations ?? []).forEach((a, i) => marks.set(a.target_part_index, [...(marks.get(a.target_part_index) ?? []), i + 1]))
  const nav = (block.nav ?? []).slice(0, 5)
  const tabs = nav.length > 0 && block.layout !== "none"
  return (
    <figure ref={root} className={cn("pres-screen pres-phone @container/phonefig w-full", className)} dir={dir} data-frame="app" data-focus={focus}>
      {!compact && block.title ? (
        <figcaption className="pres-heading mb-[0.6em] text-[1.4em] font-semibold">
          <Tx p="title" v={block.title} />
        </figcaption>
      ) : null}
      <div className={cn("flex flex-col items-center gap-[1.2em]", showNotes && block.annotations?.length && "@2xl/phonefig:flex-row @2xl/phonefig:items-center @2xl/phonefig:justify-center")}>
        <div
          data-reveal
          data-device
          className="relative flex w-[17em] max-w-full shrink-0 flex-col overflow-hidden rounded-[2.6em] border-[0.55em] border-foreground/90 bg-background text-foreground shadow-2xl"
          style={{ aspectRatio: "390 / 780" }}
        >
          <div className="flex items-center justify-between px-[1.4em] pt-[0.7em] pb-[0.3em] text-[0.84em] font-semibold" dir="ltr" data-status-bar>
            <span className="tabular-nums">9:41</span>
            <span className="absolute left-1/2 top-[0.45em] h-[1.35em] w-[5.2em] -translate-x-1/2 rounded-full bg-foreground/90" aria-hidden />
            <span className="flex items-center gap-[0.3em]" aria-hidden>
              <SignalHighIcon className="size-[1em]" />
              <WifiIcon className="size-[1em]" />
              <BatteryFullIcon className="size-[1.2em]" />
            </span>
          </div>
          {block.screen_title || block.url ? (
            <div className="border-b px-[0.9em] py-[0.5em] text-[1.05em] font-semibold" data-app-header>
              {block.screen_title || block.url}
            </div>
          ) : null}
          <div className="grid min-h-0 flex-1 content-start gap-[0.7em] overflow-hidden bg-muted/20 p-[0.8em]">
            {block.parts.map((p, i) => (
              <div
                key={i}
                data-reveal
                data-part={i}
                className={cn(
                  "relative min-w-0",
                  focus !== undefined &&
                    (i === focus
                      ? "z-10 rounded-[0.7em] shadow-xl ring-2 ring-brand ring-offset-2 ring-offset-background"
                      : "[&>*:not(.pres-marks)]:opacity-40 [&>*:not(.pres-marks)]:saturate-50"),
                )}
              >
                <EditScope at={`parts.${i}`}>
                  <Part part={p} phone dir={dir} />
                </EditScope>
                {marks.has(i) ? (
                  <span className="pres-marks absolute -end-[0.3em] -top-[0.5em] z-10 flex gap-[0.2em]">
                    {marks.get(i)!.map((n) => (
                      <Marker key={n} n={n} />
                    ))}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {tabs ? (
            <nav className="grid border-t bg-background/95 px-[0.3em] pt-[0.35em]" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }} data-tab-bar>
              {nav.map((n, i) => (
                <span key={i} data-active={n.active ? "" : undefined} className={cn("flex min-w-0 flex-col items-center gap-[0.15em] text-[0.72em]", n.active ? "font-semibold text-brand" : "text-muted-foreground")}>
                  <PresIcon name={n.icon ?? "layout-grid"} className="size-[1.5em]" />
                  <span className="max-w-full truncate">
                    <Tx p={`nav.${i}.label`} v={n.label} />
                  </span>
                </span>
              ))}
            </nav>
          ) : null}
          <div className="flex justify-center bg-background/95 pt-[0.35em] pb-[0.45em]" aria-hidden>
            <span className="h-[0.28em] w-[6em] rounded-full bg-foreground/80" />
          </div>
        </div>
        {showNotes && block.annotations?.length ? (
          <ol data-notes className="grid max-w-[22em] content-start gap-[0.6em]">
            {block.annotations.map((a, i) => (
              <li key={i} data-reveal className="flex items-start gap-[0.5em] text-[0.95em]">
                <Marker n={i + 1} />
                <span className="pt-[0.1em]">
                  <Tx p={`annotations.${i}.text`} v={a.text} />
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      {!compact && block.caption ? (
        <p className="mt-[0.6em] text-center text-[0.85em] text-muted-foreground">
          <Tx p="caption" v={block.caption} />
        </p>
      ) : null}
    </figure>
  )
}
