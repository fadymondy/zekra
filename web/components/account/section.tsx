"use client"

import type { ReactNode } from "react"

import { SectionTitle } from "@/components/page"
import { cn } from "@/lib/utils"

/** One account block: a second-level title, an optional hint, then the body between hairlines. */
export function AccountSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section>
      <SectionTitle action={action}>{title}</SectionTitle>
      {description ? <p className="grid-body -mt-1 max-w-2xl px-6 pb-3 text-sm text-pretty">{description}</p> : null}
      <div className={cn("border-y border-line px-6 py-6", className)}>{children}</div>
    </section>
  )
}

/** A one-line result under a form: success in the body colour, failure in the danger colour. */
export function StatusLine({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null
  return (
    <p role={notice.ok ? "status" : "alert"} className={cn("text-sm", notice.ok ? "text-grid-fg" : "text-grid-danger-text")}>
      {notice.text}
    </p>
  )
}
