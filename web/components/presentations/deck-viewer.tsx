"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { animate as animeAnimate } from "animejs"
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon, MinimizeIcon, NotebookTextIcon } from "lucide-react"
import { cn } from "cn"

import { useTranslations } from "@/lib/i18n"
import type { DeckContent, PageContent } from "@/lib/presentations/types"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Md } from "./markdown"
import { prefersReducedMotion, reveal } from "@/lib/presentations/motion"
import { SlideView } from "./slide"

/*
The deck viewer (FM-343): one slide at a time, 16:9, keyboard (arrows follow
the reading direction, Space/PageDown, Home/End, F for full screen, N for
notes), swipe, a progress bar, and the slide number in the URL hash so a
reload or a shared "#5" lands on the same slide.

Speaker notes are shown only when `showNotes` is set — the owner's editor.
The public view never receives notes from the API in the first place.

FM-350: slides enter with the deck's transition (slide, fade or none; the
slide direction follows the reading direction and whether you went forward or
back) and then build in: bullets, metrics, columns, workflow steps and screen
parts stagger, unless the slide sets build: false. Reduced motion shows every
slide complete. On phones (portrait or landscape) the slide fills the space
instead of staying a small 16:9 box; desktops keep 16:9.
*/
export function DeckViewer({
  content,
  embeds,
  dir,
  showNotes = false,
  className,
  fill = true,
  embedHref,
}: {
  content: DeckContent
  embeds: Record<string, { style: string; content: PageContent }>
  dir: "ltr" | "rtl"
  showNotes?: boolean
  className?: string
  /** Fill the viewport (public view) rather than the parent (editor). */
  fill?: boolean
  /** Where an embed slide's "Open the page" goes. */
  embedHref?: (documentId: string) => string | undefined
}) {
  const { t } = useTranslations()
  const total = content.slides.length
  const [index, setIndex] = useState(0)
  const [full, setFull] = useState(false)
  const [notesOpen, setNotesOpen] = useState(showNotes)
  const root = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const entered = useRef(false)

  const moved = useRef<1 | -1>(1)
  const go = useCallback(
    (i: number) =>
      setIndex((cur) => {
        const next = Math.max(0, Math.min(total - 1, i))
        if (next !== cur) moved.current = next > cur ? 1 : -1
        return next
      }),
    [total],
  )
  const stage = useRef<HTMLElement>(null)

  // #n in the URL ↔ the current slide (public view only). The write waits for
  // the read, or a re-run effect (dev StrictMode) would read back its own "#1".
  const restored = useRef(false)
  useEffect(() => {
    if (!fill || restored.current) return
    restored.current = true
    const n = Number(window.location.hash.replace("#", ""))
    if (Number.isInteger(n) && n >= 1 && n <= total) setIndex(n - 1)
  }, [fill, total])
  useEffect(() => {
    if (fill && restored.current) history.replaceState(null, "", `#${index + 1}`)
  }, [fill, index])

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.current?.requestFullscreen?.()
  }, [])

  const onKey = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight"
      const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft"
      switch (e.key) {
        case forward:
        case "PageDown":
        case " ":
        case "ArrowDown":
          e.preventDefault()
          go(index + 1)
          break
        case back:
        case "PageUp":
        case "ArrowUp":
          e.preventDefault()
          go(index - 1)
          break
        case "Home":
          e.preventDefault()
          go(0)
          break
        case "End":
          e.preventDefault()
          go(total - 1)
          break
        case "f":
        case "F":
          toggleFull()
          break
        case "n":
        case "N":
          if (showNotes) setNotesOpen((v) => !v)
          break
      }
    },
    [dir, go, index, showNotes, toggleFull, total],
  )

  // The public view listens on the window; the editor only when focused.
  useEffect(() => {
    if (!fill) return
    const handler = (e: KeyboardEvent) => onKey(e)
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [fill, onKey])

  const slide = content.slides[index]
  const selfBuilt = slide?.type === "workflow" || slide?.type === "screen"
  const build = slide?.build !== false

  // Enter, then build in. Runs for every slide change (the section is keyed by index).
  useLayoutEffect(() => {
    const el = stage.current
    if (!el || prefersReducedMotion()) return
    const transition = content.transition ?? "slide"
    const stops: (() => void)[] = []
    if (transition !== "none" && entered.current) {
      // Forward enters from the end side: the right in LTR, the left in RTL.
      const from = (dir === "rtl" ? -1 : 1) * moved.current * 36
      const a = animeAnimate(el, {
        opacity: [0, 1],
        ...(transition === "slide" ? { translateX: [from, 0] } : {}),
        duration: 380,
        ease: "outCubic",
        onComplete: () => {
          el.style.transform = ""
          el.style.opacity = ""
        },
      })
      stops.push(() => {
        a.pause()
        el.style.transform = ""
        el.style.opacity = ""
      })
    }
    entered.current = true
    if (build && !selfBuilt) stops.push(reveal(el, { delay: 120, step: 90 }))
    return () => stops.forEach((s) => s())
  }, [index, content.transition, dir, build, selfBuilt])
  const notes = slide && "notes" in slide ? slide.notes : undefined
  const Prev = dir === "rtl" ? ChevronRightIcon : ChevronLeftIcon
  const Next = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon

  return (
    <div
      ref={root}
      dir={dir}
      tabIndex={fill ? -1 : 0}
      onKeyDown={fill ? undefined : onKey}
      className={cn(
        "pres-root flex flex-col bg-background text-foreground outline-none",
        fill ? "min-h-0 flex-1" : "w-full",
        className,
      )}
      aria-roledescription="slide deck"
    >
      <Progress value={((index + 1) / total) * 100} locale={dir === "rtl" ? "ar-EG" : "en-US"} aria-label={t("presentations.deck.progress")} className="gap-0 [&_[data-slot=progress-track]]:h-1 [&_[data-slot=progress-track]]:rounded-none" />

      <div
        className={cn(
          "pres-deck-stage relative flex items-center justify-center p-3 sm:p-6",
          // The stage is a size container (the slide is sized in cqh), so it needs a real
          // height. The public view and full screen get it from the viewport. Embedded, the
          // parent often has none (an auto-height card, a scroll box): the stage collapsed to
          // a few pixels and the slide with it. There it takes its height from its own width.
          fill || full ? "min-h-0 flex-1" : "aspect-video w-full flex-none",
        )}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") touch.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const start = touch.current
          touch.current = null
          if (!start) return
          const dx = e.clientX - start.x
          if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(e.clientY - start.y)) return
          const towardsNext = dir === "rtl" ? dx > 0 : dx < 0
          go(index + (towardsNext ? 1 : -1))
        }}
        style={{ touchAction: "pan-y" }}
      >
        <section
          key={index}
          ref={stage}
          data-slide-type={slide?.type}
          aria-roledescription="slide"
          aria-label={t("presentations.deck.slideOf", { n: index + 1, total })}
          className={cn(
            "pres-slide aspect-video max-h-full w-full overflow-hidden rounded-xl border bg-card p-[4%] shadow-sm",
            // 16:9 inside whatever the stage leaves (the stage is a size container).
            "max-w-[min(100%,calc(100cqh*16/9))]",
            fill && "pres-slide-fluid",
          )}
        >
          {slide ? (
            <SlideView
              slide={slide}
              embeds={embeds}
              dir={dir}
              animate={build && selfBuilt}
              embedHref={embedHref}
              labels={{ missingEmbed: t("presentations.deck.missingEmbed"), openPage: t("presentations.deck.openPage") }}
            />
          ) : null}
        </section>
      </div>

      {showNotes && notesOpen ? (
        <aside className="max-h-40 overflow-auto border-t bg-muted/40 px-4 py-3 text-sm" aria-label={t("presentations.deck.notes")}>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("presentations.deck.notes")}</p>
          {notes ? <Md>{notes}</Md> : <p className="text-muted-foreground">{t("presentations.deck.noNotes")}</p>}
        </aside>
      ) : null}

      <nav className="flex items-center justify-between gap-2 border-t px-3 py-2" aria-label={t("presentations.deck.controls")}>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t("presentations.deck.previous")}>
            <Prev />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => go(index + 1)} disabled={index === total - 1} aria-label={t("presentations.deck.next")}>
            <Next />
          </Button>
          <span className="ms-2 text-sm tabular-nums text-muted-foreground" aria-live="polite">
            <bdi>
              {index + 1} / {total}
            </bdi>
          </span>
        </div>
        <div className="flex items-center gap-1">
          {showNotes ? (
            <Button variant={notesOpen ? "secondary" : "ghost"} size="sm" onClick={() => setNotesOpen((v) => !v)} aria-pressed={notesOpen}>
              <NotebookTextIcon />
              {t("presentations.deck.notes")}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={toggleFull} aria-label={full ? t("presentations.deck.exitFull") : t("presentations.deck.full")}>
            {full ? <MinimizeIcon /> : <MaximizeIcon />}
          </Button>
        </div>
      </nav>
    </div>
  )
}
