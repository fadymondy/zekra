"use client"

import type { ReactNode } from "react"
import { AuthFooter, AuthLayout } from "@fadymondy/nasaq/web"

import { cn } from "@/lib/utils"
import { CubeMark } from "@/components/brand/cube-mark"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { useTranslations } from "@/lib/i18n"
import { brandName } from "@/lib/brand-name"

/**
 * The signed-out frame, on Nasaq's AuthLayout: the brand mark, one h1 with its description, the
 * form, and a footer carrying the product line and the language and theme switches. Used by sign
 * in, register, recovery, the OAuth consent screen and the not-found page.
 */
export function PublicFrame({
  eyebrow: _eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  const { t, locale } = useTranslations()
  return (
    <AuthLayout
      mark={<CubeMark mark={ZEKRA_MARK} size={28} />}
      title={title}
      description={description}
      footer={
        <div className="flex flex-col items-center gap-3">
          <AuthFooter
            links={[{ label: brandName(locale), href: `/${locale}` }, { label: "fadymondy.com", href: "https://fadymondy.com", external: true }]}
            end={
              <div className="flex items-center gap-1">
                <LanguageSwitcher />
                <ThemeToggle />
              </div>
            }
          />
          <p className="text-xs text-muted-foreground">{t("footer.tagline")}</p>
        </div>
      }
    >
      {children}
    </AuthLayout>
  )
}

/** The form's container inside PublicFrame. */
export function PublicPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("flex w-full justify-center", className)}>{children}</section>
}

/** A section heading row for signed-in pages: title, optional description, optional action. */
export function SectionHeader({
  title,
  description,
  action,
  micro,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  micro?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-6">
      <div className="min-w-0 space-y-1.5">
        {micro ? <p className="eyebrow">{micro}</p> : null}
        <h1 className="text-foreground font-medium text-2xl">{title}</h1>
        {description ? <p className="text-nq-fg-body leading-relaxed max-w-2xl text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
