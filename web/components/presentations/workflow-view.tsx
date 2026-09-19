"use client"

import { useId, useLayoutEffect, useRef, useState } from "react"
import { cn } from "cn"

import { useTranslations } from "@/lib/i18n"
import { drawPaths, reveal, whenVisible } from "@/lib/presentations/motion"
import type { WorkflowBlock, WorkflowStep } from "@/lib/presentations/types"
import { connector, rowsFor, workflowEdges, type Box } from "@/lib/presentations/workflow"
import { Badge } from "@/components/ui/badge"
import { PresIcon } from "./icon"
import { Md } from "./markdown"

/*
A workflow (FM-350): steps as cards joined by drawn connectors.

Layout: horizontal rows (wrapped and balanced) or one column; "auto" turns
vertical when the container is narrow (phones), so it also works inside a
slide. The rows follow the reading direction (dir), and the connectors are
measured from the rendered cards, so right-to-left flows point right-to-left.
With `animate`, cards stagger in and the connectors draw after them; reduced
motion shows the final state at once.
*/

const KIND_STYLE: Record<string, string> = {
  step: "",
  decision: "border-[var(--pres-series-4)]/60",
  human_review: "border-dashed",
  system: "bg-muted/60",
  output: "border-brand/50 bg-brand/5",
}

function StepCard({ step, highlight, kindLabel }: { step: WorkflowStep; highlight: boolean; kindLabel: string }) {
  const kind = step.kind ?? "step"
  return (
    <div
      data-reveal
      data-step={step.id}
      data-kind={kind}
      className={cn(
        "relative flex w-full min-w-0 flex-col gap-[0.4em] rounded-[0.8em] border bg-card p-[0.75em] text-start shadow-xs",
        KIND_STYLE[kind],
        highlight && "ring-2 ring-brand ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center gap-[0.5em]">
        <span
          className={cn(
            "flex size-[2.1em] shrink-0 items-center justify-center rounded-[0.55em] border bg-muted text-brand",
            kind === "decision" && "rotate-45 rounded-[0.35em]",
            kind === "output" && "border-brand/40 bg-brand text-white",
          )}
        >
          <span className={cn("flex", kind === "decision" && "-rotate-45")}>
            <PresIcon name={step.icon ?? (kind === "decision" ? "git-branch" : kind === "human_review" ? "user-check" : kind === "system" ? "cpu" : undefined)} className="size-[1.1em]" />
          </span>
        </span>
        <span className="min-w-0 flex-1 font-semibold leading-tight text-balance">{step.title}</span>
      </div>
      {step.text ? <p className="text-[0.85em] leading-snug text-muted-foreground">{step.text}</p> : null}
      {step.owner || kind !== "step" ? (
        <div className="flex flex-wrap items-center gap-[0.35em]">
          {step.owner ? (
            <Badge variant="secondary" className="h-auto px-[0.5em] py-[0.1em] text-[0.75em]">
              {step.owner}
            </Badge>
          ) : null}
          {kind !== "step" ? (
            <Badge variant="outline" className="h-auto px-[0.5em] py-[0.1em] text-[0.75em] text-muted-foreground">
              {kindLabel}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type Drawn = { d: string; mid: { x: number; y: number }; label?: string; hot: boolean }

export function WorkflowView({
  block,
  dir,
  animate = false,
  className,
  compact = false,
}: {
  block: WorkflowBlock
  dir: "ltr" | "rtl"
  animate?: boolean
  className?: string
  /** Inside a slide: no title/body (the slide shows the title), tighter spacing. */
  compact?: boolean
}) {
  const { t } = useTranslations()
  const root = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [em, setEm] = useState(16)
  const [paths, setPaths] = useState<Drawn[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const uid = useId().replace(/[^w-]/g, "")
  const edges = workflowEdges(block)
  const n = block.steps.length

  const vertical = block.layout === "vertical" || (block.layout !== "horizontal" && width > 0 && width < em * 30)
  const perRow = Math.max(2, Math.min(6, Math.floor((width + em * 2.6) / (em * 11.5)) || 4))
  const rows = vertical ? block.steps.map(() => 1) : rowsFor(n, block.layout === "horizontal" ? Math.max(perRow, Math.min(n, 4)) : perRow)

  // Jumps along a row arc above it: leave them room.
  const arcs = !vertical && edges.some((e) => Math.abs(e.to - e.from) > 1)

  useLayoutEffect(() => {
    const el = flow.current
    if (!el) return
    const measure = () => {
      setWidth(el.clientWidth)
      setEm(parseFloat(getComputedStyle(el).fontSize) || 16)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Connectors from the rendered cards.
  useLayoutEffect(() => {
    const el = flow.current
    if (!el || width === 0) return
    const origin = el.getBoundingClientRect()
    // Transformed ancestors (a scaled preview) change the rect size, not the layout size.
    const scale = el.offsetWidth ? origin.width / el.offsetWidth : 1
    const boxes: Box[] = Array.from(el.querySelectorAll<HTMLElement>("[data-step]")).map((c) => {
      const r = c.getBoundingClientRect()
      return { x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale }
    })
    if (boxes.length !== n) return
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    setPaths(
      edges.map((e) => {
        const skip = Math.abs(e.to - e.from) > 1
        const c =
          vertical && skip
            ? side(boxes[e.from], boxes[e.to], dir === "rtl" ? "left" : "right")
            : connector(boxes[e.from], boxes[e.to])
        const hot = !!block.highlight && (block.steps[e.from].id === block.highlight || block.steps[e.to].id === block.highlight)
        return { ...c, label: e.label, hot }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry depends on layout inputs only
  }, [width, vertical, perRow, n, dir, arcs, JSON.stringify(block.edges), block.highlight])

  // Build-in: cards, then connectors.
  const played = useRef(false)
  useLayoutEffect(() => {
    if (!animate || played.current || paths.length === 0 && edges.length > 0) return
    const el = root.current
    if (!el) return
    played.current = true
    return whenVisible(el, () => {
      const stopCards = reveal(el, { step: 90 })
      const svgPaths = Array.from(el.querySelectorAll<SVGPathElement>("path[data-edge]"))
      const stopLines = drawPaths(svgPaths, { delay: 160, step: 90 })
      return () => {
        stopCards()
        stopLines()
      }
    })
  }, [animate, paths.length, edges.length])

  let start = 0
  return (
    <figure ref={root} className={cn("pres-workflow w-full", className)} data-layout={vertical ? "vertical" : "horizontal"} dir={dir}>
      {!compact && block.title ? <figcaption className="pres-heading mb-[0.4em] text-[1.4em] font-semibold">{block.title}</figcaption> : null}
      {!compact && block.body ? <Md className="mb-[1em] max-w-2xl text-muted-foreground">{block.body}</Md> : null}
      <div ref={flow} className={cn("relative", arcs && "pt-[3.4em]", vertical && edges.some((e) => Math.abs(e.to - e.from) > 1) && "px-[3.2em]")}>
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible text-muted-foreground"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
        >
          <defs>
            <marker id={`wf-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
            <marker id={`wf-${uid}-hot`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand)" />
            </marker>
          </defs>
          {paths.map((p, i) => (
            <path
              key={i}
              data-edge={i}
              d={p.d}
              fill="none"
              stroke={p.hot ? "var(--brand)" : "currentColor"}
              strokeWidth={p.hot ? 2 : 1.5}
              strokeLinecap="round"
              markerEnd={`url(#wf-${uid}${p.hot ? "-hot" : ""})`}
            />
          ))}
        </svg>
        <div className={cn("relative flex flex-col p-[8px]", vertical ? "gap-[2.2em]" : "gap-[2.6em]")}>
          {rows.map((count, r) => {
            const row = block.steps.slice(start, start + count)
            start += count
            return (
              <div
                key={r}
                className={cn("flex items-stretch justify-center", vertical ? "mx-auto w-full max-w-[26em]" : "gap-[2.6em]")}
              >
                {row.map((s) => (
                  <div key={s.id} className={cn("flex min-w-0", vertical ? "w-full" : "flex-1 basis-0")} style={vertical ? undefined : { maxWidth: "16em" }}>
                    <StepCard step={s} highlight={s.id === block.highlight} kindLabel={t(`presentations.workflow.kind.${s.kind ?? "step"}`)} />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        {paths.map((p, i) =>
          p.label ? (
            <span
              key={i}
              data-reveal
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-[0.5em] py-[0.05em] text-[0.72em] whitespace-nowrap text-muted-foreground"
              style={{ left: p.mid.x, top: p.mid.y }}
            >
              {p.label}
            </span>
          ) : null,
        )}
      </div>
      {!compact && block.caption ? <p className="mt-[0.8em] text-[0.85em] text-muted-foreground">{block.caption}</p> : null}
    </figure>
  )
}

/** A skip connector in a single column, routed around the cards on one side. */
function side(a: Box, b: Box, s: "left" | "right") {
  const out = Math.min(48, 22 + Math.abs(b.y - a.y) * 0.08)
  const sx = s === "right" ? a.x + a.w : a.x
  const ex = s === "right" ? b.x + b.w : b.x
  const sy = a.y + a.h / 2
  const ey = b.y + b.h / 2
  const k = s === "right" ? out : -out
  return { d: `M ${sx} ${sy} C ${sx + k} ${sy}, ${ex + k} ${ey}, ${ex} ${ey}`, mid: { x: Math.max(sx, ex) * (s === "right" ? 1 : 0) + Math.min(sx, ex) * (s === "right" ? 0 : 1) + k * 0.75, y: (sy + ey) / 2 } }
}
