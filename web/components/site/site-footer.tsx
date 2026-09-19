import Link from "next/link"
import { GithubIcon } from "lucide-react"

import { CubeMark } from "@/components/brand/cube-mark"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { APP_URL } from "@/lib/site/config"
import type { Landing } from "@/lib/site/landing"

/*
The foot of every zekra.dev page. Ported from fadymondy.com-v2 product-footer.tsx without the
parts that need that site's backend (newsletter, blog, testimonials, contact, legal pages).
*/
export function SiteFooter({
  spec,
  locale,
  path = "",
  maxWidth = "max-w-[1100px]",
}: {
  spec: Landing
  locale: string
  path?: string
  maxWidth?: string
}) {
  const isArabic = locale === "ar"
  const other = isArabic ? "en" : "ar"
  const link = "text-[11px] text-muted-foreground transition-colors hover:text-foreground"
  return (
    <footer className={`mx-auto w-full ${maxWidth} border-x border-t border-line px-6 py-10 sm:px-10`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CubeMark mark={ZEKRA_MARK} size={18} />
        {spec.localWordmark && isArabic ? (
          <span className="text-sm font-semibold">{spec.localWordmark}</span>
        ) : (
          <span dir="ltr" className="font-mono text-xs font-semibold tracking-[0.14em]">
            {spec.wordmark}
          </span>
        )}
        <a
          href={`https://fadymondy.com/${locale}`}
          rel="author"
          dir="ltr"
          className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          BY FADY MONDY
        </a>
        <Link href={`/${locale}/docs`} className={link}>
          {isArabic ? "التوثيق" : "Docs"}
        </Link>
        <a href={APP_URL} className={link}>
          {isArabic ? "اللوحة" : "Console"}
        </a>
        <a href={`/${other}${path}`} hrefLang={other} lang={other} className={link}>
          {isArabic ? "English" : "العربية"}
        </a>
        <span className="ms-auto flex flex-wrap items-center gap-3">
          {spec.repo ? (
            <a href={spec.repo} aria-label="GitHub" className="text-muted-foreground transition-colors hover:text-foreground">
              <GithubIcon className="size-3.5" />
            </a>
          ) : null}
          <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
            {spec.copyright}
          </span>
        </span>
      </div>
    </footer>
  )
}
