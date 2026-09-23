import Link from "next/link"

import { CubeMark } from "@/components/brand/cube-mark"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { DOCS_HREF, type Landing } from "@/lib/site/landing"

/*
zekra.dev's header: mark, wordmark, nav and the switchers. Ported from fadymondy.com-v2
components/product/product-header.tsx and shared by the landing and the docs.

`anchorBase` prefixes in-page anchors: "" on the landing, "/{locale}" on the docs, so #features
still reaches the section it names. Languages are a list (LanguageSwitcher, driven by
LOCALES) — more are coming; the footer repeats them as plain links so crawlers can follow.
*/
export function SiteHeader({
  spec,
  locale,
  path = "",
  anchorBase = "",
  maxWidth = "max-w-[1100px]",
}: {
  spec: Landing
  locale: string
  path?: string
  anchorBase?: string
  maxWidth?: string
}) {
  const href = (value: string) =>
    value === DOCS_HREF ? `/${locale}/docs` : value.startsWith("#") ? `${anchorBase}${value}` : value

  const links = spec.nav.map((item) => (
    <Link
      key={item.href + item.label}
      href={href(item.href)}
      className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {item.label}
    </Link>
  ))

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur">
      <div className={`mx-auto flex h-14 ${maxWidth} items-center gap-6 px-6 sm:px-10`}>
        <Link href={`/${locale}`} className="flex items-center gap-2.5">
          <CubeMark mark={ZEKRA_MARK} size={20} />
          {spec.localWordmark && locale === "ar" ? (
            <span className="text-sm font-semibold">{spec.localWordmark}</span>
          ) : (
            <span dir="ltr" className="font-mono text-xs font-semibold tracking-[0.14em]">
              {spec.wordmark}
            </span>
          )}
        </Link>

        <nav className="flex items-center gap-5 max-sm:hidden">{links}</nav>

        <div className="ms-auto flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      {/* Narrow screens: the nav moves to its own row rather than vanishing. */}
      <nav
        className={`mx-auto flex ${maxWidth} items-center gap-5 overflow-x-auto border-t border-line px-6 py-2.5 sm:hidden`}
      >
        {links}
      </nav>
    </header>
  )
}
