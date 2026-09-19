import Link from "next/link"
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { docHref, docsBase, editUrl, outline, PROSE, withoutLeadingTitle, type DocsBundle } from "@/lib/site/docs"
import type { Landing } from "@/lib/site/landing"
import { CopyPageButton } from "@/components/site/copy-button"
import { DocMarkdown } from "@/components/site/doc-markdown"
import { DocsSidebar } from "@/components/site/docs-sidebar"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"

const LABELS = {
  en: { onThisPage: "On this page", previous: "Previous", next: "Next", menu: "Menu", edit: "Edit on GitHub", copy: "Copy page", copied: "Copied" },
  ar: { onThisPage: "في هذه الصفحة", previous: "السابق", next: "التالي", menu: "القائمة", edit: "عدّل على GitHub", copy: "انسخ الصفحة", copied: "تم النسخ" },
}

/*
One docs page: the tree, the page, and "On this page". Ported from fadymondy.com-v2
components/docs/docs-reader.tsx. The body is the repo's English markdown, so it is marked
lang="en" dir="ltr" inside an Arabic page: the chrome follows the reader, the text follows the
language it was written in.
*/
export function DocsReader({
  spec,
  locale,
  bundle,
  index,
}: {
  spec: Landing
  locale: string
  bundle: DocsBundle
  index: number
}) {
  const t = locale === "ar" ? LABELS.ar : LABELS.en
  const page = bundle.pages[index]
  const prev = bundle.pages[index - 1]
  const next = bundle.pages[index + 1]
  const base = docsBase(locale)
  const content = withoutLeadingTitle(page.content)
  const toc = outline(content).filter((h) => h.depth === 2)
  const path = `/docs${page.slug ? `/${page.slug}` : ""}`
  const sidebar = <DocsSidebar bundle={bundle} base={base} activeSlug={page.slug} />

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background text-foreground [--header-height:--spacing(14)]">
      <SiteHeader spec={spec} locale={locale} path={path} anchorBase={`/${locale}`} maxWidth="max-w-[1280px]" />

      <main className="flex max-w-screen flex-1 flex-col overflow-x-clip px-2">
        <div className="mx-auto grid w-full max-w-[1280px] flex-1 border-x border-line lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_220px]">
          <aside className="border-line max-lg:hidden lg:border-e">
            <div className="sticky top-(--header-height) max-h-[calc(100svh-var(--header-height))] overflow-y-auto p-4">
              <p className="mb-4 px-2 text-base font-medium">{bundle.name}</p>
              {sidebar}
            </div>
          </aside>

          <article className="min-w-0">
            <div className="h-10" />

            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line p-3">
              <Link
                href={`/${locale}`}
                className="flex items-center gap-1.5 px-1 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-4 rtl:-scale-x-100" />
                {bundle.name}
              </Link>

              <div className="flex items-center gap-1.5">
                <CopyPageButton markdown={page.content} label={t.copy} copied={t.copied} />
                {prev ? (
                  <Link
                    href={docHref(locale, prev.slug)}
                    aria-label={t.previous}
                    title={t.previous}
                    className="flex size-8 items-center justify-center border border-line text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowLeftIcon className="size-3.5 rtl:-scale-x-100" />
                  </Link>
                ) : null}
                {next ? (
                  <Link
                    href={docHref(locale, next.slug)}
                    aria-label={t.next}
                    title={t.next}
                    className="flex size-8 items-center justify-center border border-line text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowRightIcon className="size-3.5 rtl:-scale-x-100" />
                  </Link>
                ) : null}
                <a
                  href={editUrl(page)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t.edit}
                  title={t.edit}
                  className="flex size-8 items-center justify-center border border-line text-muted-foreground transition-colors hover:text-foreground"
                >
                  <PencilIcon className="size-3.5" />
                </a>
              </div>
            </div>

            {/* Below lg the sidebar is gone, so the tree becomes a disclosure. */}
            <details className="border-b border-line lg:hidden">
              <summary className="cursor-pointer px-4 py-3 font-mono text-xs text-muted-foreground">
                {t.menu} · {bundle.name}
              </summary>
              <div className="max-h-[60svh] overflow-y-auto px-2 pb-4">{sidebar}</div>
            </details>

            <header className="border-b border-line px-4 py-8" lang="en" dir="ltr">
              <h1 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">{page.title}</h1>
              {page.description ? (
                <p className="mt-3 text-lg text-pretty text-muted-foreground">{page.description}</p>
              ) : null}
            </header>

            <div lang="en" dir="ltr" className={cn(PROSE, "px-4 py-8")}>
              <DocMarkdown page={page} bundle={bundle} locale={locale} content={content} />
            </div>

            <nav className="grid grid-cols-2 border-t border-line">
              {prev ? (
                <Link href={docHref(locale, prev.slug)} className="flex flex-col gap-1 border-e border-line p-4 hover:bg-muted/40">
                  <span className="font-mono text-[11px] text-muted-foreground uppercase">{t.previous}</span>
                  <span className="truncate text-sm" lang="en" dir="ltr">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span className="border-e border-line" />
              )}
              {next ? (
                <Link href={docHref(locale, next.slug)} className="flex flex-col items-end gap-1 p-4 text-end hover:bg-muted/40">
                  <span className="font-mono text-[11px] text-muted-foreground uppercase">{t.next}</span>
                  <span className="truncate text-sm" lang="en" dir="ltr">
                    {next.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </article>

          <aside className="border-s border-line max-xl:hidden">
            {toc.length > 0 ? (
              <div className="sticky top-(--header-height) max-h-[calc(100svh-var(--header-height))] overflow-x-hidden overflow-y-auto p-4">
                <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{t.onThisPage}</p>
                <ul lang="en" dir="ltr" className="mt-3 flex flex-col border-s border-line text-sm">
                  {toc.map((h) => (
                    <li key={h.id}>
                      <a
                        href={`#${h.id}`}
                        className="-ms-px block border-s border-transparent py-1 ps-3 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        {h.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      </main>

      <SiteFooter spec={spec} locale={locale} path={path} maxWidth="max-w-[1280px]" />
    </div>
  )
}
