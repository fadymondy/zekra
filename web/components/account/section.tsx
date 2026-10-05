"use client"

import type { ReactNode } from "react"

import { Panel } from "@/components/page"
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
    <section className="px-4 pt-4 md:px-6">
      <Panel title={title} hint={description} action={action}>
        <div className={cn("pt-1", className)}>{children}</div>
      </Panel>
    </section>
  )
}

/** A one-line result under a form: success in the body colour, failure in the danger colour. */
export function StatusLine({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null
  return (
    <p role={notice.ok ? "status" : "alert"} className={cn("text-sm", notice.ok ? "text-foreground" : "text-nq-danger-text")}>
      {notice.text}
    </p>
  )
}
