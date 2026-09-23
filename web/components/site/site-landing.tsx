import Link from "next/link"
import { ArrowRightIcon, GithubIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { CubeMark } from "@/components/brand/cube-mark"
import { PRODUCT_MARKS, type MarkSpec } from "@/app/styles/grid-marks"
import { ZEKRA_MARK } from "@/lib/brand/mark"
import { DOCS_HREF, RELATED, type Landing } from "@/lib/site/landing"
import { CopyButton } from "@/components/site/copy-button"
import { Icon } from "@/components/site/icons"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"

/*
zekra.dev's landing page. Ported from fadymondy.com-v2 components/product/product-landing.tsx
(+ landing-blocks.tsx), keeping only the sections zekra.dev renders, in the same order and with
the same classes, plus the presentations block for the second audience. Copy comes from
content/site/landing.{en,ar}.json.
*/

const SECTION = "border-t border-line px-6 py-14 sm:px-10"

/** A mark that swaps to its on-dark body colour in dark mode, when it has one. */
function ThemedMark({ mark, size }: { mark: MarkSpec; size: number }) {
  if (!mark.bodyOnDark) return <CubeMark mark={mark} size={size} />
  return (
    <>
      <CubeMark mark={mark} size={size} className="dark:hidden" />
      <CubeMark mark={{ ...mark, body: mark.bodyOnDark }} size={size} className="hidden dark:block" />
    </>
  )
}

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-8 scroll-mt-20 text-2xl font-semibold tracking-tight sm:text-[26px]">
      {children}
    </h2>
  )
}

function Ordinal({ n }: { n: number }) {
  return (
    <span dir="ltr" className="font-mono text-xs text-brand">
      {String(n + 1).padStart(2, "0")}
    </span>
  )
}

function Terminal({ terminal }: { terminal: NonNullable<Landing["terminal"]> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card/40">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-red-500/70" />
          <span className="size-2.5 rounded-full bg-amber-500/70" />
          <span className="size-2.5 rounded-full bg-emerald-500/70" />
        </span>
        <span dir="ltr" className="ms-2 font-mono text-xs text-muted-foreground">
          {terminal.title}
        </span>
      </div>
      <pre dir="ltr" className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed whitespace-pre">
        {terminal.lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              line.tone === "prompt" && "text-foreground",
              line.tone === "ok" && "text-emerald-500",
              (!line.tone || line.tone === "muted") && "text-muted-foreground",
            )}
          >
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  )
}

function CardGrid({ cards, cols = "sm:grid-cols-2" }: { cards: Landing["features"]["cards"]; cols?: string }) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border border-line bg-line", cols)}>
      {cards.map((card) => (
        <article key={card.title} className="bg-background p-6">
          <span className="mb-4 flex size-8 items-center justify-center rounded border border-line text-brand">
            <Icon name={card.icon} className="size-4" />
          </span>
          <h3 className="text-base font-medium">{card.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.copy}</p>
        </article>
      ))}
    </div>
  )
}

export function SiteLanding({ spec, locale }: { spec: Landing; locale: string }) {
  const isArabic = locale === "ar"
  const href = (value: string) => (value === DOCS_HREF ? `/${locale}/docs` : value)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader spec={spec} locale={locale} />

      <main className="mx-auto max-w-[1100px] border-x border-line">
        {/* Hero */}
        <section className="px-6 py-16 sm:px-10">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
            <div className="min-w-0">
              <CubeMark mark={ZEKRA_MARK} size={44} />
              {/* Latin eyebrows are mono and letter-spaced; Arabic drops both (cursive joins). */}
              <p
                className={cn(
                  "mt-6 text-[12.5px] text-brand",
                  isArabic ? "text-xs font-medium" : "font-mono tracking-[0.1em]",
                )}
              >
                {spec.eyebrow}
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{spec.headline ?? spec.name}</h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">{spec.tagline}</p>
            </div>

            {spec.terminal ? (
              <div className="min-w-0">
                <Terminal terminal={spec.terminal} />
              </div>
            ) : null}
          </div>

          {/* The install bar: the copyable command beside the primary action. */}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-stretch">
            {spec.install ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md border border-line bg-card/40 px-4 py-3">
                <span aria-hidden className="font-mono text-sm text-brand">
                  $
                </span>
                <code
                  dir="ltr"
                  className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap text-foreground/90"
                >
                  {spec.install}
                </code>
                <CopyButton text={spec.install} label={isArabic ? "نسخ" : "Copy"} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={href(spec.primaryAction.href)}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-5 py-3 text-sm font-medium whitespace-nowrap text-brand-foreground transition-opacity hover:opacity-90"
              >
                {spec.primaryAction.label}
                <ArrowRightIcon className="size-4 rtl:rotate-180" />
              </a>
              {spec.secondaryAction ? (
                <Link
                  href={href(spec.secondaryAction.href)}
                  className="inline-flex items-center rounded-md border border-line px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors hover:bg-card"
                >
                  {spec.secondaryAction.label}
                </Link>
              ) : null}
            </div>
          </div>

          {/* Fact chips, each with its icon. */}
          <ul className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
            {spec.chips.map((chip) => (
              <li key={chip.label} className="flex items-center gap-3 bg-background px-4 py-3 text-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded border border-line text-brand">
                  <Icon name={chip.icon} className="size-3.5" />
                </span>
                {chip.label}
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section className={SECTION}>
          <SectionTitle id={spec.features.id ?? "features"}>{spec.features.title}</SectionTitle>
          {spec.features.note ? (
            <p className="-mt-4 mb-6 max-w-2xl text-sm text-muted-foreground">{spec.features.note}</p>
          ) : null}
          <CardGrid cards={spec.features.cards} />
        </section>

        {spec.explainer ? (
          <section className={SECTION}>
            <SectionTitle id={spec.explainer.id}>{spec.explainer.title}</SectionTitle>
            {spec.explainer.note ? (
              <p className="-mt-4 mb-6 max-w-2xl text-sm text-muted-foreground">{spec.explainer.note}</p>
            ) : null}
            <pre
              dir="ltr"
              className="overflow-x-auto rounded-lg border border-line bg-card/40 p-5 font-mono text-[13px] leading-relaxed text-muted-foreground"
            >
              {spec.explainer.diagram}
            </pre>
            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
              {spec.explainer.items.map((item) => (
                <article key={item.title} className="bg-background p-6">
                  <h3 className="text-base font-medium">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.copy}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* The second audience: the team that turns the brain into decks, reports and pages. */}
        {spec.presentations ? (
          <section className={SECTION}>
            {spec.presentations.eyebrow ? (
              <p
                className={cn(
                  "mb-3 text-[12.5px] text-brand",
                  isArabic ? "text-xs font-medium" : "font-mono tracking-[0.1em]",
                )}
              >
                {spec.presentations.eyebrow}
              </p>
            ) : null}
            <h2
              id={spec.presentations.id}
              className="max-w-3xl scroll-mt-20 text-2xl font-semibold tracking-tight text-balance sm:text-[26px]"
            >
              {spec.presentations.title}
            </h2>
            <p className="mt-4 mb-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">{spec.presentations.copy}</p>
            <CardGrid cards={spec.presentations.cards} cols="sm:grid-cols-2 lg:grid-cols-3" />
            <div className="mt-6 flex flex-wrap gap-3">
              {spec.presentations.actions.map((action) => (
                <a
                  key={action.href + action.label}
                  href={href(action.href)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-5 py-3 text-sm font-medium whitespace-nowrap text-brand-foreground transition-opacity hover:opacity-90"
                >
                  {action.label}
                  <ArrowRightIcon className="size-4 rtl:rotate-180" />
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {/* Flat icon grid: the MCP tools */}
        {spec.grid ? (
          <section className={SECTION}>
            <SectionTitle id="grid">{spec.grid.title}</SectionTitle>
            <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {spec.grid.items.map((item) => (
                <li key={item.label} className="flex items-center gap-3 bg-background px-4 py-3.5 text-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded border border-line text-brand">
                    <Icon name={item.icon} className="size-3.5" />
                  </span>
                  <span dir="ltr">{item.label}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Grouped tags: what it is built on */}
        {spec.groups ? (
          <section className={SECTION}>
            <SectionTitle id="groups">{spec.groups.title}</SectionTitle>
            <div className="grid gap-8 sm:grid-cols-3">
              {spec.groups.groups.map((group, index) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2">
                    <Ordinal n={index} />
                    <h3 className="text-sm font-medium">{group.label}</h3>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <li
                        key={item}
                        dir="ltr"
                        className="rounded border border-line px-2 py-1 font-mono text-[12.5px] text-muted-foreground"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {spec.steps ? (
          <section className={SECTION}>
            <SectionTitle id={spec.steps.id ?? "get-started"}>{spec.steps.title}</SectionTitle>
            {spec.steps.note ? (
              <p className="-mt-4 mb-6 max-w-2xl text-sm text-muted-foreground">{spec.steps.note}</p>
            ) : null}
            <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {spec.steps.steps.map((step, index) => (
                <li key={step.title} className="bg-background p-5">
                  <div className="flex items-center gap-2">
                    <Ordinal n={index} />
                    <h3 className="text-sm font-medium">{step.title}</h3>
                  </div>
                  {step.copy ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.copy}</p> : null}
                  {step.code ? (
                    <pre
                      dir="ltr"
                      className="mt-3 overflow-x-auto rounded border border-line bg-card/40 px-3 py-2 font-mono text-xs text-foreground/90"
                    >
                      <code>{step.code}</code>
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {spec.closing ? (
          <section className={SECTION}>
            <SectionTitle id={spec.steps ? undefined : "get-started"}>{spec.closing.title}</SectionTitle>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{spec.closing.copy}</p>
          </section>
        ) : null}

        {spec.community ? (
          <section className={SECTION}>
            <SectionTitle>{isArabic ? "المجتمع" : "Community"}</SectionTitle>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={spec.repo ?? "https://github.com/fadymondy"}
                className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm transition-colors hover:bg-card"
              >
                <GithubIcon className="size-4" />
                GitHub
              </a>
              <span className="font-mono text-[12.5px] text-muted-foreground">{isArabic ? "مُصان" : "maintained"}</span>
            </div>
          </section>
        ) : null}

        {spec.related?.length ? (
          <section className={SECTION}>
            <SectionTitle id="ecosystem">{isArabic ? "المزيد من المنظومة" : "More from the ecosystem"}</SectionTitle>
            <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
              {spec.related.map((item) => {
                const sibling = RELATED[item.domain]
                if (!sibling) return null
                const mark = PRODUCT_MARKS[sibling.mark]
                return (
                  <a
                    key={item.domain}
                    href={`https://${item.domain}/${locale}`}
                    className="group/rel flex flex-col bg-background p-6 transition-colors hover:bg-card sm:last:odd:col-span-2"
                  >
                    <div className="flex items-center gap-3">
                      {mark ? <ThemedMark mark={mark} size={24} /> : null}
                      <h3 dir="ltr" className="text-base font-medium">
                        {sibling.name}
                      </h3>
                      <ArrowRightIcon className="ms-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover/rel:translate-x-0.5 rtl:rotate-180 rtl:group-hover/rel:-translate-x-0.5" />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.copy}</p>
                  </a>
                )
              })}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              <a href={`https://fadymondy.com/${locale}/projects`} className="transition-colors hover:text-foreground">
                {isArabic ? "كل مشاريع فادي مندي ←" : "All projects by Fady Mondy →"}
              </a>
            </p>
          </section>
        ) : null}

        {spec.cta ? (
          <section className={cn(SECTION, "text-center")}>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{spec.cta.title}</h2>
            {spec.cta.copy ? (
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{spec.cta.copy}</p>
            ) : null}
            {spec.cta.code ? (
              <div className="mx-auto mt-6 flex max-w-xl items-center gap-2.5 rounded-md border border-line bg-card/40 px-4 py-3">
                <span aria-hidden className="font-mono text-sm text-brand">
                  $
                </span>
                <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto text-start font-mono text-sm whitespace-nowrap">
                  {spec.cta.code}
                </code>
                <CopyButton text={spec.cta.code} label={isArabic ? "نسخ" : "Copy"} />
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {spec.cta.actions.map((action, i) => (
                <a
                  key={action.label}
                  href={href(action.href)}
                  className={cn(
                    "inline-flex items-center rounded-md px-5 py-3 text-sm font-medium transition-colors",
                    i === 0 ? "bg-brand text-brand-foreground hover:opacity-90" : "border border-line hover:bg-card",
                  )}
                >
                  {action.label}
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <SiteFooter spec={spec} locale={locale} />
    </div>
  )
}
