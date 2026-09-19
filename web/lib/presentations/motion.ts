"use client"

import { useEffect, type RefObject } from "react"
import { animate, stagger, utils } from "animejs"

/*
Presentation motion (FM-350), on anime.js v4.

Server-rendered content is always visible: an element only hides its
[data-reveal] children once this code runs (data-anim="pending"), and every
path ends in the final state — on completion, on a timeout (a tab that is not
painting never runs requestAnimationFrame), or at once when the reader
prefers reduced motion. PDFs are built from separate print HTML and are never
animated.
*/

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

/** The [data-reveal] parts of root, leaving out those of a nested screen or workflow (they animate themselves). */
export function ownParts(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll("[data-reveal]")).filter((t) => {
    const owner = t.parentElement?.closest(".pres-screen, .pres-workflow")
    return !owner || owner === root || !root.contains(owner)
  })
}

function finish(root: HTMLElement, targets: Element[]) {
  utils.set(targets, { opacity: 1, translateY: 0, translateX: 0, scale: 1 })
  root.dataset.anim = "done"
}

/** Stagger root's [data-reveal] children in. Returns a cancel function. */
export function reveal(root: HTMLElement, opts: { delay?: number; step?: number; from?: "start" | "center" } = {}): () => void {
  const targets = ownParts(root)
  if (targets.length === 0 || prefersReducedMotion()) {
    root.dataset.anim = "done"
    return () => {}
  }
  root.dataset.anim = "pending"
  utils.set(targets, { opacity: 0, translateY: 14 })
  const anim = animate(targets, {
    opacity: [0, 1],
    translateY: [14, 0],
    duration: 520,
    ease: "outQuart",
    delay: stagger(opts.step ?? 70, { start: opts.delay ?? 0 }),
    onComplete: () => finish(root, targets),
  })
  const safety = window.setTimeout(() => finish(root, targets), (opts.delay ?? 0) + (opts.step ?? 70) * targets.length + 1600)
  return () => {
    window.clearTimeout(safety)
    anim.pause()
    finish(root, targets)
  }
}

/**
 * Reveal when the element scrolls into view (once). `immediate` skips the
 * observer (a hero, or a slide that is already on screen).
 */
export function useReveal(ref: RefObject<HTMLElement | null>, opts: { enabled?: boolean; immediate?: boolean; delay?: number; step?: number; key?: unknown } = {}) {
  const { enabled = true, immediate = false, delay, step, key } = opts
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let cancel: (() => void) | undefined
    if (immediate || typeof IntersectionObserver === "undefined") {
      cancel = reveal(el, { delay, step })
      return () => cancel?.()
    }
    // Hide now (only below the fold) so the reveal does not flash.
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight * 0.9) {
      cancel = reveal(el, { delay, step })
      return () => cancel?.()
    }
    if (!prefersReducedMotion()) {
      el.dataset.anim = "pending"
      utils.set(ownParts(el), { opacity: 0 })
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          cancel = reveal(el, { delay, step })
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    )
    io.observe(el)
    // A browser that never delivers the callback (not painting) still ends visible.
    const safety = window.setTimeout(() => {
      if (el.dataset.anim === "pending" && !cancel) {
        io.disconnect()
        utils.set(ownParts(el), { opacity: 1, translateY: 0 })
        el.dataset.anim = "done"
      }
    }, 8000)
    return () => {
      io.disconnect()
      window.clearTimeout(safety)
      cancel?.()
    }
  }, [ref, enabled, immediate, delay, step, key])
}

/** Draw SVG paths (connectors) in order, then show their arrowheads. */
export function drawPaths(paths: SVGPathElement[], opts: { delay?: number; step?: number } = {}): () => void {
  if (paths.length === 0) return () => {}
  if (prefersReducedMotion()) return () => {}
  const lengths = paths.map((p) => p.getTotalLength?.() ?? 0)
  paths.forEach((p, i) => {
    p.style.strokeDasharray = `${lengths[i]}`
    p.style.strokeDashoffset = `${lengths[i]}`
  })
  const done = () =>
    paths.forEach((p) => {
      p.style.strokeDasharray = ""
      p.style.strokeDashoffset = ""
    })
  const anims = paths.map((p, i) =>
    animate(p, {
      strokeDashoffset: [lengths[i], 0],
      duration: 420,
      ease: "inOutQuad",
      delay: (opts.delay ?? 0) + (opts.step ?? 110) * i,
      ...(i === paths.length - 1 ? { onComplete: done } : {}),
    }),
  )
  const safety = window.setTimeout(done, (opts.delay ?? 0) + (opts.step ?? 110) * paths.length + 1500)
  return () => {
    window.clearTimeout(safety)
    anims.forEach((x) => x.pause())
    done()
  }
}

/**
 * Run `play` once el is on screen (at once if it already is). Parts below the
 * fold are hidden while they wait, and shown anyway after 8s if the browser
 * never reports them (a tab that is not painting).
 */
export function whenVisible(el: HTMLElement, play: () => () => void): () => void {
  let stop: (() => void) | undefined
  const rect = el.getBoundingClientRect()
  if (typeof IntersectionObserver === "undefined" || rect.top < window.innerHeight * 0.95) {
    stop = play()
    return () => stop?.()
  }
  const parts = Array.from(el.querySelectorAll("[data-reveal]"))
  if (!prefersReducedMotion()) utils.set(parts, { opacity: 0 })
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && !stop) {
        io.disconnect()
        stop = play()
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  )
  io.observe(el)
  const safety = window.setTimeout(() => {
    if (!stop) {
      io.disconnect()
      utils.set(parts, { opacity: 1 })
    }
  }, 8000)
  return () => {
    io.disconnect()
    window.clearTimeout(safety)
    stop?.()
  }
}
