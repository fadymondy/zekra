"use client"

import { useRef, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "cn"

import { useTranslations } from "@/lib/i18n"
import type { PageContent, PageSection } from "@/lib/presentations/types"
import { STYLE_KEYS } from "@/lib/presentations/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { PresTheme } from "./pres-theme"
import { EditScope, Tx, TxMd } from "./edit"
import { Md } from "./markdown"
import { useReveal } from "@/lib/presentations/motion"
import { PresIcon } from "./icon"
import { SceneView } from "./scenes/scene"
import { ScreenView } from "./screen-view"
import { WorkflowView } from "./workflow-view"

/*
A page preview (FM-346): a concept landing page composed from typed sections,
in one of four style presets built on the site's tokens. Server-rendered
(scenes hydrate client-side). CTAs are real links only when the author gave
an http(s) or site URL; otherwise they render as a non-interactive label so a
concept page never ships a button that does nothing.
*/

function Cta({ label, href, variant = "default", p = "cta_label" }: { label?: string; href?: string; variant?: "default" | "outline"; p?: string }) {
  if (!label) return null
  if (!href) {
    return (
      <Badge variant="outline" className="h-8 px-3 text-sm">
        <Tx p={p} v={label} />
      </Badge>
    )
  }
  const external = /^https?:/i.test(href)
  return (
    <Button variant={variant} size="lg" nativeButton={false} render={<a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} />}>
      <Tx p={p} v={label} />
    </Button>
  )
}

const HEIGHTS = { sm: "h-48", md: "h-72 sm:h-96", lg: "h-[28rem] sm:h-[36rem]" } as const

function Section({
  s,
  dir,
  compact,
  sceneLabel,
  animate,
}: {
  s: PageSection
  dir: "ltr" | "rtl"
  compact: boolean
  sceneLabel: string
  animate: boolean
}) {
  const pad = compact ? "px-5 py-8" : "px-5 py-14 sm:px-10 sm:py-20"
  switch (s.type) {
    case "hero":
      return (
        <section className={cn("pres-hero relative overflow-hidden border-b", s.scene ? "min-h-[26rem]" : "")}>
          {s.scene ? (
            <SceneView
              scene={s.scene}
              label={sceneLabel}
              dir={dir}
              fill
              // From lg the scene takes the half opposite the text panel, so its centre is never
              // behind it; logical `start` makes that the left half in RTL. Phones and compact
              // previews keep the scene behind the text.
              className={cn("absolute inset-0 opacity-90", !compact && !s.visual && "lg:start-1/2")}
            />
          ) : null}
          {/*
            Three shapes (production review): with a visual, text and visual share the row
            (stacked on phones); with only a scene, the text keeps the half opposite the
            scene; with neither, the text uses the full width, centred.
          */}
          <div
            className={cn(
              "pres-section relative",
              pad,
              compact ? "" : "sm:py-28",
              s.visual && "grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12",
            )}
          >
            <div
              data-reveal
              data-hero-text
              className={cn(
                "rounded-xl p-4 sm:p-6",
                s.scene || s.visual ? "bg-background/70 backdrop-blur-sm" : "",
                s.visual ? "min-w-0" : s.scene ? cn("max-w-2xl", !compact && "lg:max-w-[46%]") : "mx-auto max-w-4xl text-center",
              )}
            >
              {s.eyebrow ? (
                <p className="pres-eyebrow mb-3 text-sm font-medium text-brand">
                  <Tx p="eyebrow" v={s.eyebrow} />
                </p>
              ) : null}
              <h1 className={cn("pres-heading text-balance", compact ? "text-3xl" : s.visual ? "text-4xl sm:text-5xl" : "text-4xl sm:text-6xl")}>
                <Tx p="heading" v={s.heading} />
              </h1>
              {s.body ? (
                <TxMd p="body" raw={s.body}>
                  <Md className={cn("mt-5 text-lg text-muted-foreground", !s.scene && !s.visual && "mx-auto max-w-2xl")}>{s.body}</Md>
                </TxMd>
              ) : null}
              <div className={cn("mt-8 flex flex-wrap gap-3", !s.scene && !s.visual && "justify-center")}>
                <Cta label={s.cta_label} href={s.cta_href} />
              </div>
            </div>
            {s.visual ? (
              <div data-hero-visual className="min-w-0">
                <EditScope at="visual">
                  {s.visual.type === "screen" ? (
                    <ScreenView block={s.visual} dir={dir} animate={animate} compact className="pres-screen-text" />
                  ) : (
                    <WorkflowView block={s.visual} dir={dir} animate={animate} compact className="text-base" />
                  )}
                </EditScope>
              </div>
            ) : null}
          </div>
        </section>
      )
    case "features":
      return (
        <section className={cn("pres-section border-b", pad)}>
          {s.heading ? (
            <h2 className="pres-heading mb-3 text-3xl text-balance">
              <Tx p="heading" v={s.heading} />
            </h2>
          ) : null}
          {s.body ? (
            <TxMd p="body" raw={s.body}>
              <Md className="mb-8 max-w-2xl text-muted-foreground">{s.body}</Md>
            </TxMd>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.items.map((it, i) => {
              return (
                <Card key={i} data-reveal className="pres-glow">
                  <CardHeader>
                    <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted text-brand">
                      {it.icon ? <PresIcon name={it.icon} className="size-4" /> : <span className="size-2 rounded-full bg-brand" aria-hidden />}
                    </div>
                    <CardTitle>
                      <Tx p={`items.${i}.title`} v={it.title} />
                    </CardTitle>
                    {it.body ? (
                      <CardDescription>
                        <TxMd p={`items.${i}.body`} raw={it.body}>
                          <Md>{it.body}</Md>
                        </TxMd>
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                </Card>
              )
            })}
          </div>
        </section>
      )
    case "pricing":
      return (
        <section className={cn("pres-section border-b", pad)}>
          {s.heading ? (
            <h2 className="pres-heading mb-3 text-3xl">
              <Tx p="heading" v={s.heading} />
            </h2>
          ) : null}
          {s.body ? (
            <TxMd p="body" raw={s.body}>
              <Md className="mb-8 max-w-2xl text-muted-foreground">{s.body}</Md>
            </TxMd>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {s.plans.map((p, i) => (
              <Card key={i} data-reveal className={cn("pres-glow", p.highlighted && "ring-2 ring-brand")}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <Tx p={`plans.${i}.name`} v={p.name} />
                    {p.highlighted ? <Badge>★</Badge> : null}
                  </CardTitle>
                  <p className="mt-2">
                    <bdi className="text-3xl font-semibold tabular-nums">
                      <Tx p={`plans.${i}.price`} v={p.price} />
                    </bdi>
                    {p.period ? (
                      <span className="ms-1 text-muted-foreground">
                        <Tx p={`plans.${i}.period`} v={p.period} />
                      </span>
                    ) : null}
                  </p>
                  {p.description ? (
                    <CardDescription>
                      <Tx p={`plans.${i}.description`} v={p.description} />
                    </CardDescription>
                  ) : null}
                </CardHeader>
                {p.features?.length ? (
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {p.features.map((f, j) => (
                        <li key={j} className="flex gap-2">
                          <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <Tx p={`plans.${i}.features.${j}`} v={f} list={{ path: `plans.${i}.features`, index: j }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                ) : null}
                {p.cta_label ? (
                  <CardFooter>
                    <Cta label={p.cta_label} p={`plans.${i}.cta_label`} />
                  </CardFooter>
                ) : null}
              </Card>
            ))}
          </div>
        </section>
      )
    case "testimonial":
      return (
        <section className={cn("pres-section border-b text-center", pad)}>
          <blockquote data-reveal className="mx-auto max-w-3xl">
            <p className="pres-heading text-2xl text-balance sm:text-3xl">
              <q>
                <Tx p="quote" v={s.quote} />
              </q>
            </p>
            <footer className="mt-5 text-muted-foreground">
              <Tx p="author" v={s.author} />
              {s.role ? (
                <>
                  {" · "}
                  <Tx p="role" v={s.role} />
                </>
              ) : null}
            </footer>
          </blockquote>
        </section>
      )
    case "cta":
      return (
        <section className={cn("pres-section border-b text-center", pad)}>
          <h2 data-reveal className="pres-heading text-3xl text-balance sm:text-4xl">
            <Tx p="heading" v={s.heading} />
          </h2>
          {s.body ? (
            <TxMd p="body" raw={s.body}>
              <Md className="mx-auto mt-4 max-w-xl text-muted-foreground">{s.body}</Md>
            </TxMd>
          ) : null}
          <div className="mt-8 flex justify-center">
            <Cta label={s.cta_label} href={s.cta_href} />
          </div>
        </section>
      )
    case "gallery":
      return (
        <section className={cn("pres-section border-b", pad)}>
          {s.heading ? (
            <h2 className="pres-heading mb-6 text-3xl">
              <Tx p="heading" v={s.heading} />
            </h2>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.images.map((im, i) => (
              <figure key={i} data-reveal className="overflow-hidden rounded-xl border">
                {/* eslint-disable-next-line @next/next/no-img-element -- validated http(s) or site path */}
                <img src={im.url} alt={im.alt} className="aspect-video w-full object-cover" loading="lazy" />
                {im.caption ? (
                  <figcaption className="p-3 text-sm text-muted-foreground">
                    <Tx p={`images.${i}.caption`} v={im.caption} />
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      )
    case "scene":
      return (
        <section className="border-b">
          {s.heading || s.body ? (
            <div className={cn("pres-section", compact ? "px-5 pt-8" : "px-5 pt-14 sm:px-10")}>
              {s.heading ? (
                <h2 className="pres-heading text-3xl">
                  <Tx p="heading" v={s.heading} />
                </h2>
              ) : null}
              {s.body ? (
                <TxMd p="body" raw={s.body}>
                  <Md className="mt-3 max-w-2xl text-muted-foreground">{s.body}</Md>
                </TxMd>
              ) : null}
            </div>
          ) : null}
          <SceneView
            scene={s.scene}
            label={s.heading || sceneLabel}
            dir={dir}
            // A code scene keeps its own aspect ratio; the vetted scenes take the height preset.
            className={cn("w-full", s.scene.type === "code" ? "" : HEIGHTS[s.height ?? "md"])}
          />
        </section>
      )
    case "workflow":
      return (
        <section className={cn("pres-section border-b", pad)}>
          <WorkflowView block={s} dir={dir} animate={animate} className="text-[0.95rem] sm:text-base" />
        </section>
      )
    case "screen":
      return (
        <section className={cn("pres-section border-b", pad)}>
          <ScreenView block={s} dir={dir} animate={animate} className="pres-screen-text" />
        </section>
      )
  }
}

/** Reveals the [data-reveal] parts of a section when it scrolls into view (FM-350). */
function Reveal({ children, enabled, immediate }: { children: ReactNode; enabled: boolean; immediate: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useReveal(ref, { enabled, immediate, step: 80 })
  return <div ref={ref}>{children}</div>
}

export function PagePreview({
  content,
  style,
  compact = false,
  dir: forced,
  still = false,
}: {
  content: PageContent
  style: string
  compact?: boolean
  dir?: "ltr" | "rtl"
  /** No motion (a scaled thumbnail, the editor). */
  still?: boolean
}) {
  const motion = !compact && !still
  const { t, locale } = useTranslations()
  const dir = forced ?? (locale === "ar" ? "rtl" : "ltr")
  const key = (STYLE_KEYS as string[]).includes(style) ? style : "minimal"
  const page = (
    <PresTheme className={cn("pres-root", `pres-style-${key}`)}>
      <div dir={dir}>
        {content.sections.map((s, i) => (
          <Reveal key={i} enabled={motion && s.type !== "workflow" && s.type !== "screen"} immediate={i === 0}>
            <EditScope at={`sections.${i}`}>
              <div data-section={i}>
                <Section s={s} dir={dir} compact={compact} sceneLabel={t("presentations.scene.label")} animate={motion} />
              </div>
            </EditScope>
          </Reveal>
        ))}
      </div>
    </PresTheme>
  )
  return key === "tech-dark" ? <div className="dark">{page}</div> : page
}
