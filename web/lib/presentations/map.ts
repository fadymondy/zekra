/*
Dispatch-map geometry (FM-350 follow-up), shared by the live view and the
print SVG. Pure and deterministic: the same markers always get the same city.

The "city" is procedural — a skewed street grid with avenues and a boulevard,
a river and a park — so a map needs no tiles and no network. Markers, routes
and zones are placed on top in percentages of the map.
*/
import type { MapPart, Tone } from "./types.ts"

export const MAP_WIDTH = 1000
export const MAP_HEIGHTS = { sm: 420, md: 600, lg: 780 } as const

export type Street = { d: string; width: number; main: boolean }
export type City = {
  w: number
  h: number
  streets: Street[]
  river: { d: string; width: number }
  park: { x: number; y: number; w: number; h: number }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function mapSeed(part: MapPart): number {
  return hash(part.markers.map((m) => m.id).join("|") + (part.title ?? ""))
}

/** portrait: a phone map, taller than wide (the height preset then scales it). */
export function cityFor(part: MapPart, height: keyof typeof MAP_HEIGHTS = part.height ?? "md", portrait = false): City {
  const w = MAP_WIDTH
  const h = portrait ? Math.round((MAP_HEIGHTS[height] ?? MAP_HEIGHTS.md) * 2.2) : (MAP_HEIGHTS[height] ?? MAP_HEIGHTS.md)
  const rand = rng(mapSeed(part))
  const streets: Street[] = []
  let i = 0
  for (let x = 40 + rand() * 60; x < w; x += 90 + rand() * 50, i++) {
    const skew = (rand() - 0.5) * 50
    const main = i % 3 === 1
    streets.push({ d: `M ${r1(x)} -10 L ${r1(x + skew)} ${h + 10}`, width: main ? 16 : 8, main })
  }
  i = 0
  for (let y = 30 + rand() * 50; y < h; y += 80 + rand() * 40, i++) {
    const skew = (rand() - 0.5) * 40
    const main = i % 3 === 1
    streets.push({ d: `M -10 ${r1(y)} L ${w + 10} ${r1(y + skew)}`, width: main ? 16 : 8, main })
  }
  // A boulevard across the grid.
  const by = h * (0.15 + rand() * 0.2)
  streets.push({ d: `M -10 ${r1(by)} L ${w + 10} ${r1(by + h * 0.55)}`, width: 18, main: true })
  // River: a lazy S across the bottom half.
  const ry = h * (0.62 + rand() * 0.15)
  const river = {
    d: `M -20 ${r1(ry)} C ${r1(w * 0.25)} ${r1(ry - h * 0.18)}, ${r1(w * 0.55)} ${r1(ry + h * 0.2)}, ${w + 20} ${r1(ry - h * 0.05)}`,
    width: 34,
  }
  const pw = 120 + rand() * 60
  const ph = 80 + rand() * 50
  const park = { x: r1(w * (0.55 + rand() * 0.25)), y: r1(h * (0.08 + rand() * 0.2)), w: r1(pw), h: r1(ph) }
  return { w, h, streets, river, park }
}

export const pt = (city: City, x: number, y: number) => ({
  x: r1((Math.max(0, Math.min(100, x)) / 100) * city.w),
  y: r1((Math.max(0, Math.min(100, y)) / 100) * city.h),
})

/** A route's points in map units: from, via…, to. Missing endpoints give null. */
export function routePoints(part: MapPart, city: City, route: NonNullable<MapPart["routes"]>[number]) {
  const byId = new Map(part.markers.map((m) => [m.id, m]))
  const a = byId.get(route.from)
  const b = byId.get(route.to)
  if (!a || !b) return null
  return [pt(city, a.x, a.y), ...(route.via ?? []).map((v) => pt(city, v.x, v.y)), pt(city, b.x, b.y)]
}

/** Rounded polyline through the points. */
export function routePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ""
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const n = points[i + 1]
    const mx = r1((p.x + n.x) / 2)
    const my = r1((p.y + n.y) / 2)
    d += ` Q ${p.x} ${p.y} ${mx} ${my}`
  }
  const last = points[points.length - 1]
  return d + ` L ${last.x} ${last.y}`
}

export type Palette = Record<"bg" | "street" | "casing" | "river" | "park" | "brand" | "info" | "success" | "warning" | "danger" | "neutral" | "ink", string>

/** Theme colours as CSS (live view). */
export const CSS_PALETTE: Palette = {
  bg: "var(--pres-map-bg)",
  street: "var(--pres-map-street)",
  casing: "var(--pres-map-casing)",
  river: "var(--pres-map-river)",
  park: "var(--pres-map-park)",
  brand: "var(--brand)",
  info: "var(--pres-series-1)",
  success: "var(--pres-series-6)",
  warning: "var(--pres-series-4)",
  danger: "var(--destructive)",
  neutral: "var(--muted-foreground)",
  ink: "var(--foreground)",
}

/** Fixed colours for print. */
export const PRINT_PALETTE: Palette = {
  bg: "#ece8df",
  street: "#ffffff",
  casing: "#d6cfc1",
  river: "#bcd3ee",
  park: "#cfe3c9",
  brand: "#e2661c",
  info: "#2a78d6",
  success: "#008300",
  warning: "#c98500",
  danger: "#d03b3b",
  neutral: "#8a8f99",
  ink: "#0e1a3c",
}

export const MARKER_ICON: Record<string, string> = { driver: "bike", vendor: "store", customer: "map-pin", hub: "warehouse" }

/** A marker's colour: its tone, else drivers by status, else by kind. */
export function markerColor(m: MapPart["markers"][number], p: Palette): string {
  if (m.tone && m.tone !== "neutral") return p[m.tone as Tone]
  if (m.kind === "driver") {
    const s = (m.status ?? "").toLowerCase()
    return s === "busy" ? p.warning : s === "offline" ? p.neutral : p.success
  }
  return m.kind === "vendor" ? p.brand : m.kind === "customer" ? p.info : p.ink
}

export const isAvailableDriver = (m: MapPart["markers"][number]) => m.kind === "driver" && (m.status ?? "available").toLowerCase() === "available"
