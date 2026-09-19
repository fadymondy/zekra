import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react"
import { cn } from "cn"

import { bulletIcon, bulletText, type PageContent, type Slide } from "@/lib/presentations/types"
import { IfSet, NoEdit, Tx, TxMd } from "./edit"
import { EmbedPreview } from "./embed-preview"
import { FitBox } from "./fit-box"
import { PresIcon } from "./icon"
import { Md } from "./markdown"
import { PhoneScreen, ScreenView } from "./screen-view"
import { WorkflowView } from "./workflow-view"

/*
One deck slide (FM-343), sized by its container (container queries in
presentations.css), so the same component fills the full-screen viewer, the
editor's preview and a thumbnail. Parts that build in carry data-reveal; the
viewer staggers them (FM-350) unless the slide sets build: false.
*/
export type SlideLabels = { missingEmbed: string; openPage: string }

export function SlideView({
  slide,
  embeds,
  labels,
  dir = "ltr",
  animate = false,
  embedHref,
}: {
  slide: Slide
  embeds: Record<string, { style: string; content: PageContent }>
  labels: SlideLabels
  dir?: "ltr" | "rtl"
  /** Build the slide in (the viewer sets this for the slide on screen). */
  animate?: boolean
  /** Where "Open the page" goes for an embedded page preview. */
  embedHref?: (documentId: string) => string | undefined
}) {
  const title = (t?: string) => (
    <IfSet v={t}>
      <h2 className="pres-slide-title mb-[4cqh] font-semibold text-balance">
        <Tx p="title" v={t} />
      </h2>
    </IfSet>
  )
  switch (slide.type) {
    case "title":
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          {slide.icon ? (
            <span data-reveal className="mb-[4cqh] flex size-[max(3rem,9cqh)] items-center justify-center rounded-[22%] border bg-muted text-brand">
              <PresIcon name={slide.icon} className="size-[55%]" />
            </span>
          ) : null}
          <IfSet v={slide.eyebrow}>
            <p data-reveal className="pres-slide-body mb-[3cqh] font-medium text-brand">
              <Tx p="eyebrow" v={slide.eyebrow} />
            </p>
          </IfSet>
          <h1 data-reveal className="pres-slide-hero font-semibold text-balance">
            <Tx p="title" v={slide.title} />
          </h1>
          <IfSet v={slide.subtitle}>
            <p data-reveal className="pres-slide-body mt-[4cqh] text-muted-foreground text-balance">
              <Tx p="subtitle" v={slide.subtitle} />
            </p>
          </IfSet>
        </div>
      )
    case "bullets":
      return (
        <div className="flex h-full flex-col justify-center">
          {title(slide.title)}
          <ul className="pres-slide-body space-y-[2cqh]">
            {slide.bullets.map((b, i) => {
              const icon = bulletIcon(b)
              return (
                <li key={i} data-reveal className="flex items-start gap-[1.5cqw]">
                  {icon ? (
                    <span aria-hidden className="mt-[0.05em] flex size-[1.45em] shrink-0 items-center justify-center rounded-[0.35em] bg-brand/10 text-brand">
                      <PresIcon name={icon} className="size-[0.85em]" />
                    </span>
                  ) : (
                    <span aria-hidden className="mt-[0.55em] size-[0.45em] shrink-0 rounded-full bg-brand" />
                  )}
                  <span className="min-w-0 flex-1">
                    <Tx p={typeof b === "string" ? `bullets.${i}` : `bullets.${i}.text`} v={bulletText(b)} list={{ path: "bullets", index: i }} />
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )
    case "image":
      return (
        <figure className="flex h-full flex-col justify-center">
          {title(slide.title)}
          {/* eslint-disable-next-line @next/next/no-img-element -- remote, validated http(s) or site path */}
          <img data-reveal src={slide.image_url} alt={slide.alt} className="mx-auto max-h-[60cqh] max-w-full rounded-lg border object-contain" />
          <IfSet v={slide.caption}>
            <figcaption className="mt-[2cqh] text-center text-muted-foreground">
              <Tx p="caption" v={slide.caption} />
            </figcaption>
          </IfSet>
        </figure>
      )
    case "quote":
      return (
        <blockquote className="flex h-full flex-col items-center justify-center text-center">
          <p data-reveal className="pres-slide-title max-w-[80cqw] font-medium text-balance">
            <q>
              <Tx p="quote" v={slide.quote} />
            </q>
          </p>
          <IfSet v={slide.author}>
            <footer data-reveal className="pres-slide-body mt-[5cqh] text-muted-foreground">
              <Tx p="author" v={slide.author} />
              <IfSet v={slide.role}>
                {" · "}
                <Tx p="role" v={slide.role} />
              </IfSet>
            </footer>
          </IfSet>
        </blockquote>
      )
    case "metric":
      return (
        <div className="flex h-full flex-col justify-center">
          {title(slide.title)}
          <div className="pres-metrics grid gap-[2cqw]" style={{ ["--cols" as string]: Math.min(slide.metrics.length, 3) }}>
            {slide.metrics.map((m, i) => (
              <div key={i} data-reveal className="rounded-xl border bg-card p-[2.5cqw]">
                <div className="flex items-start justify-between gap-2">
                  <div className="pres-slide-title font-semibold tabular-nums">
                    <bdi>
                      <Tx p={`metrics.${i}.value`} v={m.value} />
                    </bdi>
                  </div>
                  {m.icon ? (
                    <span className="flex size-[max(1.8rem,6cqh)] shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <PresIcon name={m.icon} className="size-[55%]" />
                    </span>
                  ) : null}
                </div>
                <div className="mt-[1cqh] text-muted-foreground">
                  <Tx p={`metrics.${i}.label`} v={m.label} />
                </div>
                {m.delta ? (
                  <div className="mt-[1cqh] flex items-center gap-1 text-sm">
                    {m.trend === "up" ? <ArrowUpIcon className="size-4" aria-hidden /> : m.trend === "down" ? <ArrowDownIcon className="size-4" aria-hidden /> : <MinusIcon className="size-4" aria-hidden />}
                    <bdi>
                      <Tx p={`metrics.${i}.delta`} v={m.delta} />
                    </bdi>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )
    case "two_column":
      return (
        <div className="flex h-full flex-col justify-center">
          {title(slide.title)}
          <div className="pres-two-col grid gap-[4cqw]">
            {[slide.left, slide.right].map((c, i) => {
              const side = i === 0 ? "left" : "right"
              return (
              <div key={i} data-reveal className={cn("space-y-[1.5cqh]", i === 1 && "pres-two-col-second")}>
                {c.heading ? (
                  <h3 className="pres-slide-body flex items-center gap-[0.45em] font-semibold">
                    {c.icon ? (
                      <span className="flex size-[1.6em] shrink-0 items-center justify-center rounded-[0.4em] bg-brand/10 text-brand">
                        <PresIcon name={c.icon} className="size-[0.9em]" />
                      </span>
                    ) : null}
                    <Tx p={`${side}.heading`} v={c.heading} />
                  </h3>
                ) : null}
                <TxMd p={`${side}.body`} raw={c.body}>
                  <Md>{c.body}</Md>
                </TxMd>
                {c.bullets?.length ? (
                  <ul className="list-disc space-y-1 ps-5">
                    {c.bullets.map((b, j) => (
                      <li key={j}>
                        <Tx p={`${side}.bullets.${j}`} v={b} list={{ path: `${side}.bullets`, index: j }} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              )
            })}
          </div>
        </div>
      )
    case "code":
      return (
        <div className="flex h-full flex-col justify-center">
          {title(slide.title)}
          <pre dir="ltr" data-reveal className="max-h-[62cqh] overflow-auto rounded-lg border bg-muted/60 p-[2cqw] text-start font-mono text-[clamp(0.7rem,1.6cqw,1.1rem)] leading-relaxed">
            <code>
              <Tx p="code" v={slide.code} multiline />
            </code>
          </pre>
          {slide.language ? <p className="mt-2 font-mono text-xs text-muted-foreground">{slide.language}</p> : null}
        </div>
      )
    case "workflow":
      return (
        <div className="flex h-full min-h-0 flex-col">
          {title(slide.title)}
          <FitBox dir={dir} className="pres-slide-fit flex-1">
            <WorkflowView block={slide} dir={dir} animate={animate} compact className="pres-slide-small" />
          </FitBox>
        </div>
      )
    case "screen":
      if (slide.frame === "app") {
        // A phone: title, caption and numbered notes on one side, the device on the other
        // (the grid follows the reading direction); stacked on a narrow slide.
        return (
          <div className="pres-app-slide grid h-full min-h-0 items-center gap-[4cqw]">
            <div className="min-w-0 space-y-[2cqh]" data-reveal>
              <IfSet v={slide.title}>
                <h2 className="pres-slide-title font-semibold text-balance">
                  <Tx p="title" v={slide.title} />
                </h2>
              </IfSet>
              <IfSet v={slide.caption}>
                <p className="pres-slide-body text-muted-foreground">
                  <Tx p="caption" v={slide.caption} />
                </p>
              </IfSet>
              {slide.annotations?.length ? (
                <ol className="pres-slide-body grid gap-[1.5cqh]" data-notes>
                  {slide.annotations.map((a, i) => (
                    <li key={i} className="flex items-start gap-[0.5em]">
                      <span className="flex size-[1.5em] shrink-0 items-center justify-center rounded-full bg-brand text-[0.9em] font-bold text-white">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <Tx p={`annotations.${i}.text`} v={a.text} />
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <div className="pres-phone-host flex min-h-0 justify-center">
              <PhoneScreen block={slide} dir={dir} animate={animate} compact notes={false} />
            </div>
          </div>
        )
      }
      // The mockup gets the slide: a one-line title, notes over the frame, and a base size
      // that keeps its smallest text readable (production review).
      return (
        <div className="flex h-full min-h-0 flex-col">
          <IfSet v={slide.title}>
            <h2 className="pres-slide-body mb-[2cqh] font-semibold text-balance">
              <Tx p="title" v={slide.title} />
            </h2>
          </IfSet>
          <FitBox dir={dir} className="pres-slide-fit flex-1" minScale={0.8}>
            <ScreenView block={slide} dir={dir} animate={animate} compact className="pres-screen-slide" />
          </FitBox>
        </div>
      )
    case "embed": {
      const emb = embeds[slide.document_id]
      return (
        <div className="flex h-full min-h-0 flex-col">
          {title(slide.title)}
          {emb ? (
            <NoEdit>
              <EmbedPreview
              content={emb.content}
              style={emb.style}
              dir={dir}
              href={embedHref?.(slide.document_id)}
              openLabel={labels.openPage}
              className="min-h-0 flex-1"
            />
            </NoEdit>
          ) : (
            <p className="text-muted-foreground">{labels.missingEmbed}</p>
          )}
        </div>
      )
    }
  }
}
