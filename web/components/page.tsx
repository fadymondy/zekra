"use client"

// Signed-in page building blocks, exactly as Managy draws its pages: full-bleed, no outer
// padding; sections run edge to edge between the sidebar hairline and the viewport, split by
// their own hairlines. Content sits at px-6 so it lines up with the section header.
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
    <div className={cn("border-y border-line p-3 hatch-band", className)} role="status">
      <div className="border border-line bg-grid-card px-5 py-4">{children}</div>
    </div>
  )
}

/** Managy's overview detail strip: full-bleed cells split by hairlines, a micro label over a value. */
export function DetailStrip({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  const cols = items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
  return (
    <dl
      className={cn(
        "grid grid-cols-1 divide-y divide-line border-y border-line text-sm sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse",
        cols,
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} className="px-6 py-4">
          <dt className="grid-micro mb-1">{it.label}</dt>
          <dd className="text-grid-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A hairline list (Managy's activity feed): rows at px-6 py-3 split by hairlines. */
export function RowList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ol className={cn("divide-y divide-line border-y border-line", className)} aria-label={label}>
      {children}
    </ol>
  )
}
