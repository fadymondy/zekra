"use client"

// Signed-in page building blocks, exactly as Managy draws its pages: full-bleed, no outer
// padding; sections run edge to edge between the sidebar hairline and the viewport, split by
// their own hairlines. Content sits at px-6 so it lines up with the section header.
import { Card, CardContent, StatCard, StatGrid } from "@fadymondy/nasaq/web"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export { SectionHeader } from "@/components/public-frame"

/** A second-level heading between full-bleed blocks (Managy's "Recent activity"). */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-3">
      <h2 className="text-base font-medium">{children}</h2>
      {action}
    </div>
  )
}

/** Managy's "In development" notice: a hatched band framing a card. */
export function HatchBand({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("hatch border-y border-border p-3", className)} role="status">
      <div className="border border-border bg-card px-5 py-4">{children}</div>
    </div>
  )
}

/** Managy's overview detail strip: full-bleed cells split by hairlines, a micro label over a value. */
export function DetailStrip({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  const cols = items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
  return (
    <dl
      className={cn(
        "grid grid-cols-1 divide-y divide-border border-y border-border text-sm sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse",
        cols,
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} className="px-6 py-4">
          <dt className="eyebrow mb-1">{it.label}</dt>
          <dd className="text-foreground">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A hairline list (Managy's activity feed): rows at px-6 py-3 split by hairlines. */
export function RowList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ol className={cn("divide-y divide-border border-y border-border", className)} aria-label={label}>
      {children}
    </ol>
  )
}

// ---- Nasaq card layout: a padded page body of rounded cards, rows with gaps instead of hairlines.

/** The padded column a Nasaq page's cards sit in. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4 p-4 md:p-6", className)}>{children}</div>
}

/** A rounded card with an optional title row (title, hint, action). */
export function Panel({ id, title, hint, action, danger, children, className }: { id?: string; title?: ReactNode; hint?: ReactNode; action?: ReactNode; danger?: boolean; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("rounded-xl", danger && "border-nq-danger/40", className)} aria-labelledby={title && id ? id : undefined}>
      <CardContent className="flex flex-col gap-3">
        {title || action ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            {title ? (
              <div className="min-w-0">
                <h2 id={id} className={cn("text-base font-medium", danger && "text-nq-danger-text")}>
                  {title}
                </h2>
                {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
              </div>
            ) : null}
            {action ? <div className="ms-auto flex items-center gap-2">{action}</div> : null}
          </div>
        ) : null}
        {children}
      </CardContent>
    </Card>
  )
}

/** KPI tiles: Nasaq StatCards in a rounded grid. */
export function StatStrip({ items, loading }: { items: { label: ReactNode; value: ReactNode; icon?: ReactNode }[]; loading?: boolean }) {
  return (
    <StatGrid className={items.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}>
      {items.map((it, i) => (
        <StatCard key={i} className="rounded-xl" loading={loading} icon={it.icon} label={it.label} value={it.value} />
      ))}
    </StatGrid>
  )
}

/** A list of rounded rows with gaps; pair rows with `cardRow`. */
export function CardList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ol className={cn("-mx-2 flex flex-col gap-1", className)} aria-label={label}>
      {children}
    </ol>
  )
}

/** Row chrome inside a CardList. */
export const cardRow = "rounded-lg px-2 py-2.5 transition-colors hover:bg-nq-hover"
