/*
Scene params, defensively (FM-346).

The Go validator already range-checks every param and fills defaults, so the
renderers normally receive clean data. They still read params through these
helpers: a renderer must never trust a number enough to allocate 10 million
particles because a row was edited by hand.
*/

export const COLOR_TOKENS = [
  "brand",
  "primary",
  "accent",
  "foreground",
  "muted",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const

/** The CSS variable each token reads. `accent` is the brand gold, not shadcn's surface accent. */
export const TOKEN_VARS: Record<string, string> = {
  brand: "--brand",
  primary: "--primary",
  accent: "--brand-accent",
  foreground: "--foreground",
  muted: "--muted-foreground",
  // The site's --chart-* are greys; scenes use the presentation series palette instead.
  "chart-1": "--pres-series-1",
  "chart-2": "--pres-series-2",
  "chart-3": "--pres-series-3",
  "chart-4": "--pres-series-4",
  "chart-5": "--pres-series-5",
}

export function num(params: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number {
  const v = params[key]
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

export function int(params: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number {
  return Math.round(num(params, key, min, max, fallback))
}

export function bool(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = params[key]
  return typeof v === "boolean" ? v : fallback
}

export function oneOf<T extends string>(params: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const v = params[key]
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

export function token(params: Record<string, unknown>, key: string, fallback: string): string {
  return oneOf(params, key, COLOR_TOKENS, fallback as (typeof COLOR_TOKENS)[number])
}

export function tokens(params: Record<string, unknown>, key: string, fallback: string[], max = 4): string[] {
  const v = params[key]
  if (!Array.isArray(v)) return fallback
  const out = v.filter((x): x is string => typeof x === "string" && (COLOR_TOKENS as readonly string[]).includes(x))
  return out.length >= 2 ? out.slice(0, max) : fallback
}

export function strings(params: Record<string, unknown>, key: string, max: number, maxLen: number): string[] {
  const v = params[key]
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === "string")
    .slice(0, max)
    .map((s) => s.slice(0, maxLen))
}

export function numbers(params: Record<string, unknown>, key: string, max: number): number[] {
  const v = params[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).slice(0, max)
}

/** Resolves a colour token to the computed colour on an element. */
export function resolveToken(el: Element, name: string): string {
  const variable = TOKEN_VARS[name] ?? "--brand"
  const value = getComputedStyle(el).getPropertyValue(variable).trim()
  return value || getComputedStyle(el).color
}

/** The scene types the web app can render — must equal SceneTypes in scenes.go. */
export const THREE_SCENES = ["particles", "globe", "floating_geometry", "product_orbit"] as const
export const CANVAS_SCENES = ["gradient_mesh", "generative_lines", "chart"] as const
/** Model-written HTML/JS, rendered only in a sandboxed iframe (code-scene.ts). */
export const IFRAME_SCENES = ["code"] as const
