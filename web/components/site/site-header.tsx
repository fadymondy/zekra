import Link from "next/link"
import { LanguagesIcon } from "lucide-react"

import { CubeMark } from "@/components/brand/cube-mark"
import { ThemeToggle } from "@/components/header-controls"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { DOCS_HREF, type Landing } from "@/lib/site/landing"

/*
zekra.dev's header: mark, wordmark, nav and the switchers. Ported from fadymondy.com-v2
components/product/product-header.tsx and shared by the landing and the docs.

`anchorBase` prefixes in-page anchors: "" on the landing, "/{locale}" on the docs, so #features
still reaches the section it names. `path` is the locale-less current path, for the language
link. It is a plain link, not a dropdown, so a crawler can follow it to the other language.
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
  const other = locale === "ar" ? "en" : "ar"
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
          <a
            href={`/${other}${path}`}
            hrefLang={other}
            lang={other}
            aria-label={other === "ar" ? "العربية" : "English"}
            title={other === "ar" ? "العربية" : "English"}
            className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <LanguagesIcon className="size-4" />
          </a>
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
