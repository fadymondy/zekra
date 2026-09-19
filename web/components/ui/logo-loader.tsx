"use client"

import { Benday } from "@/components/ui/benday"

/**
 * The brand mark rendered as an animated Ben-Day dot field (@benday/benday,
 * "Flicker" preset), replacing the previous animejs pulse on a static PNG.
 *
 * The API is unchanged — every existing call site keeps working — and the
 * component handles `prefers-reduced-motion` itself via `reducedMotion="auto"`,
 * so the manual media-query check the old version carried is gone.
 */
export function LogoLoader({
  size = 56,
  label = "Loading",
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div className={className}>
      <Benday
        src="/brand/mark.png"
        preset="flicker"
        state="thinking"
        size={size}
        color="currentColor"
        aria-label={label}
      />
      <span className="sr-only">{label}</span>
    </div>
  )
}
