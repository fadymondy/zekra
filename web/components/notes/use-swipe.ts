import { useCallback, useRef, useState } from "react"

/*
Horizontal swipe for list rows.

TOUCH ONLY, deliberately. On a desktop browser a mouse-drag gesture fights
text selection, and a trackpad's horizontal scroll is indistinguishable from
an intentional swipe — so a pointer-agnostic implementation makes the list feel
broken on the device most web users have. Mouse and keyboard users get the
context menu instead, which carries the same actions.

Vertical intent wins: if the first movement is mostly vertical the gesture is
released back to the scroller, so swiping never hijacks a scroll.
*/

export interface SwipeConfig {
  /** Past this many px, releasing triggers the action. */
  threshold?: number
  /** Swipe toward the inline-end edge (left in LTR). */
  onEnd?: () => void
  /** Swipe toward the inline-start edge (right in LTR). */
  onStart?: () => void
  /** RTL mirrors which side means what. */
  rtl?: boolean
  disabled?: boolean
}

const DEFAULT_THRESHOLD = 72
/** Below this, a gesture is a tap, not a swipe. */
const SLOP = 8

export function useSwipe({ threshold = DEFAULT_THRESHOLD, onEnd, onStart, rtl = false, disabled }: SwipeConfig) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  // null = undecided, true = horizontal swipe, false = released to the scroller
  const horizontal = useRef<boolean | null>(null)

  const reset = useCallback(() => {
    start.current = null
    horizontal.current = null
    setDx(0)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.pointerType !== "touch") return
      start.current = { x: e.clientX, y: e.clientY }
      horizontal.current = null
    },
    [disabled],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current || e.pointerType !== "touch") return
      const deltaX = e.clientX - start.current.x
      const deltaY = e.clientY - start.current.y

      if (horizontal.current === null) {
        if (Math.abs(deltaX) < SLOP && Math.abs(deltaY) < SLOP) return
        // Decide once: a mostly-vertical first move belongs to the scroller.
        horizontal.current = Math.abs(deltaX) > Math.abs(deltaY)
        if (!horizontal.current) {
          start.current = null
          return
        }
        // Only capture after deciding, or a vertical scroll would be stolen.
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }
      setDx(deltaX)
    },
    [],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current || horizontal.current !== true) {
        reset()
        return
      }
      const deltaX = e.clientX - start.current.x
      reset()
      if (Math.abs(deltaX) < threshold) return
      // In RTL the visual sides swap, so the handlers swap with them.
      const towardStart = rtl ? deltaX < 0 : deltaX > 0
      if (towardStart) onStart?.()
      else onEnd?.()
    },
    [threshold, onStart, onEnd, rtl, reset],
  )

  return {
    /** Current horizontal offset, for translating the row. */
    dx,
    /** True once the gesture has committed to horizontal. */
    swiping: horizontal.current === true,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
    },
  }
}
