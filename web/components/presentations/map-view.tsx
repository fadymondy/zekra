"use client"

import { useEffect, useMemo, useRef } from "react"
import { animate } from "animejs"
import { BikeIcon, MapPinIcon, NavigationIcon, StoreIcon, WarehouseIcon, type LucideIcon } from "lucide-react"
import { cn } from "cn"

import { useTranslations } from "@/lib/i18n"
import { CSS_PALETTE, cityFor, isAvailableDriver, markerColor, pt, routePath, routePoints } from "@/lib/presentations/map"
import { drawPaths, prefersReducedMotion, whenVisible } from "@/lib/presentations/motion"
import type { MapPart } from "@/lib/presentations/types"

/*
A dispatch map (FM-350 follow-up): a procedural city (lib/presentations/map.ts)
with coverage zones, routes, markers and a nearest-driver suggestion on top.

The map itself is always laid out left-to-right — a pin never mirrors in
Arabic — while labels, the suggestion card and the legend follow the reading
direction. Motion: available drivers pulse, routes draw in, and a driver that
starts a route rides along it (looping). Reduced motion: all still.
*/
const ICON: Record<string, LucideIcon> = { driver: BikeIcon, vendor: StoreIcon, customer: MapPinIcon, hub: WarehouseIcon }
const P = CSS_PALETTE

export function MapView({ part, dir, className, portrait = false }: { part: MapPart; dir: "ltr" | "rtl"; className?: string; portrait?: boolean }) {
  const { t } = useTranslations()
  // In a phone the map is a tall mobile map; sm/md/lg still set how tall.
  const city = useMemo(() => cityFor(part, part.height ?? (portrait ? "sm" : "md"), portrait), [part, portrait])
  const root = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(part.markers.map((m) => [m.id, m])), [part.markers])
  const routes = useMemo(
    () =>
      (part.routes ?? [])
        .map((r) => ({ r, pts: routePoints(part, city, r) }))
        .filter((x): x is { r: NonNullable<MapPart["routes"]>[number]; pts: { x: number; y: number }[] } => !!x.pts),
    [part, city],
  )
  const sug = part.suggest && byId.get(part.suggest.vendor) && byId.get(part.suggest.driver) ? part.suggest : undefined
  const sv = sug ? byId.get(sug.vendor)! : undefined
  const sd = sug ? byId.get(sug.driver)! : undefined

  useEffect(() => {
    const el = root.current
    if (!el) return
    return whenVisible(el, () => {
      const paths = Array.from(el.querySelectorAll<SVGPathElement>("path[data-route]"))
      const stopDraw = drawPaths(paths, { step: 160 })
      const loops: { pause: () => void }[] = []
      if (!prefersReducedMotion()) {
        // A driver at the start of a route rides it.
        paths.forEach((path) => {
          const id = path.dataset.from
          const pin = id ? el.querySelector<HTMLElement>(`[data-marker="${CSS.escape(id)}"]`) : null
          if (!pin || pin.dataset.kind !== "driver") return
          const len = path.getTotalLength()
          const state = { t: 0 }
          loops.push(
            animate(state, {
              t: [0, 0.92],
              duration: 5200 + len * 6,
              delay: 900,
              ease: "inOutSine",
              loop: true,
              alternate: true,
              onUpdate: () => {
                const p = path.getPointAtLength(len * state.t)
                pin.style.left = `${(p.x / city.w) * 100}%`
                pin.style.top = `${(p.y / city.h) * 100}%`
              },
            }),
          )
        })
      }
      return () => {
        stopDraw()
        loops.forEach((l) => l.pause())
      }
    })
  }, [city, routes.length])

  const kinds = Array.from(new Set(part.markers.map((m) => m.kind)))
  return (
    <figure className={cn("pres-map", className)} dir={dir}>
      {part.title ? <p className="mb-[0.5em] text-[0.8em] font-semibold tracking-wide text-muted-foreground uppercase">{part.title}</p> : null}
      <div
        ref={root}
        dir="ltr"
        data-map
        className="relative w-full overflow-hidden rounded-[0.6em] border"
        style={{ aspectRatio: `${city.w} / ${city.h}`, background: P.bg }}
        role="img"
        aria-label={part.title ?? t("presentations.map.label")}
      >
        <svg viewBox={`0 0 ${city.w} ${city.h}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <rect x={city.park.x} y={city.park.y} width={city.park.w} height={city.park.h} rx={14} fill={P.park} />
          <path d={city.river.d} fill="none" stroke={P.river} strokeWidth={city.river.width} strokeLinecap="round" />
          {city.streets.map((s, i) => (
            <path key={`c${i}`} d={s.d} stroke={P.casing} strokeWidth={s.width + 3} fill="none" />
          ))}
          {city.streets.map((s, i) => (
            <path key={`s${i}`} d={s.d} stroke={P.street} strokeWidth={s.width} fill="none" />
          ))}
          {(part.zones ?? []).map((z, i) => {
            const c = pt(city, z.x, z.y)
            const col = P[z.tone ?? "info"]
            return (
              <circle
                key={i}
                cx={c.x}
                cy={c.y}
                r={(z.r / 100) * city.w}
                fill={col}
                fillOpacity={0.1}
                stroke={col}
                strokeOpacity={0.55}
                strokeWidth={2}
                strokeDasharray="8 6"
              />
            )
          })}
          {routes.map(({ r, pts }, i) => (
            <path
              key={i}
              data-route={i}
              data-from={r.from}
              d={routePath(pts)}
              fill="none"
              stroke={P[r.tone ?? "info"]}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={r.dashed ? "2 12" : undefined}
            />
          ))}
          {sv && sd ? (
            <line
              data-suggest-line
              x1={pt(city, sd.x, sd.y).x}
              y1={pt(city, sd.x, sd.y).y}
              x2={pt(city, sv.x, sv.y).x}
              y2={pt(city, sv.x, sv.y).y}
              stroke={P.brand}
              strokeWidth={4}
              strokeDasharray="10 8"
              strokeLinecap="round"
            />
          ) : null}
        </svg>

        {(part.zones ?? []).map((z, i) =>
          z.label ? (
            <span
              key={i}
              dir={dir}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[0.8em] font-semibold tracking-wide text-muted-foreground uppercase"
              style={{ left: `${z.x}%`, top: `${Math.max(3, z.y - (z.r * city.w) / city.h + 3)}%` }}
            >
              {z.label}
            </span>
          ) : null,
        )}
        {routes.map(({ r, pts }, i) => {
          if (!r.label) return null
          const m = pts[Math.floor(pts.length / 2)]
          return (
            <span
              key={i}
              dir={dir}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background/95 px-[0.5em] text-[0.8em] whitespace-nowrap shadow-xs"
              style={{ left: `${(m.x / city.w) * 100}%`, top: `${(m.y / city.h) * 100}%` }}
            >
              {r.label}
            </span>
          )
        })}

        {part.markers.map((m) => {
          const Icon = ICON[m.kind] ?? MapPinIcon
          const color = markerColor(m, P)
          const round = m.kind === "driver" || m.kind === "hub"
          const suggested = sug?.driver === m.id
          return (
            <div
              key={m.id}
              data-marker={m.id}
              data-kind={m.kind}
              className={cn("absolute z-10 flex flex-col items-center", round ? "-translate-x-1/2 -translate-y-1/2" : "-translate-x-1/2 -translate-y-full")}
              style={{ left: `${m.x}%`, top: `${m.y}%` }}
            >
              {round ? (
                <span className="relative flex size-[2.1em] items-center justify-center">
                  {isAvailableDriver(m) || suggested ? (
                    <span className={cn("pres-pulse absolute inset-0 rounded-full", suggested && "pres-pulse-strong")} style={{ background: suggested ? P.brand : color }} aria-hidden />
                  ) : null}
                  <span
                    className="relative flex size-full items-center justify-center rounded-full border-2 border-background text-white shadow-md"
                    style={{ background: color, outline: suggested ? `2px solid ${P.brand}` : undefined, outlineOffset: 2 }}
                  >
                    <Icon className="size-[55%]" aria-hidden />
                  </span>
                </span>
              ) : (
                <span className="relative flex flex-col items-center" aria-hidden>
                  <span className="flex size-[2em] items-center justify-center rounded-full border-2 border-background text-white shadow-md" style={{ background: color }}>
                    <Icon className="size-[55%]" />
                  </span>
                  <span className="-mt-[0.2em] size-0 border-x-[0.35em] border-t-[0.5em] border-x-transparent" style={{ borderTopColor: color }} />
                </span>
              )}
              {m.label ? (
                <span dir={dir} className="mt-[0.15em] rounded-[0.35em] bg-background/95 px-[0.35em] text-[0.8em] font-medium whitespace-nowrap shadow-xs" data-marker-label>
                  {m.label}
                </span>
              ) : null}
            </div>
          )
        })}

        {sv && sd && sug ? (
          <div
            data-suggest-card
            dir={dir}
            className="absolute z-20 max-w-[16em] -translate-x-1/2 rounded-[0.6em] border bg-background/95 p-[0.55em] text-start shadow-lg backdrop-blur"
            style={{ left: `${Math.min(80, Math.max(20, (sv.x + sd.x) / 2))}%`, // Below the lower pin, or above the higher one near the bottom edge.
              top: Math.max(sv.y, sd.y) < 68 ? `${Math.max(sv.y, sd.y) + 7}%` : undefined,
              bottom: Math.max(sv.y, sd.y) >= 68 ? `${100 - Math.min(sv.y, sd.y) + 9}%` : undefined }}
          >
            <div className="flex items-center gap-[0.35em] text-[0.8em] font-semibold text-brand">
              <NavigationIcon className="size-[1em]" aria-hidden />
              {t("presentations.map.nearest")}
            </div>
            <div className="text-[0.85em] font-medium">
              {sd.label ?? sd.id} → {sv.label ?? sv.id}
            </div>
            {sug.eta || sug.distance ? (
              <div className="text-[0.8em] text-muted-foreground">
                <bdi>{[sug.eta, sug.distance].filter(Boolean).join(" · ")}</bdi>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {part.legend ? (
        <ul className="mt-[0.5em] flex flex-wrap gap-x-[1em] gap-y-[0.3em] text-[0.86em] text-muted-foreground" data-legend>
          {kinds.map((k) => {
            const Icon = ICON[k]
            return (
              <li key={k} className="flex items-center gap-[0.35em]">
                <span className="flex size-[1.4em] items-center justify-center rounded-full text-white" style={{ background: markerColor({ id: "", x: 0, y: 0, kind: k }, P) }}>
                  <Icon className="size-[60%]" aria-hidden />
                </span>
                {t(`presentations.map.kind.${k}`)}
              </li>
            )
          })}
          {part.markers.some((m) => m.kind === "driver") ? (
            <>
              {(["available", "busy", "offline"] as const).map((s) => (
                <li key={s} className="flex items-center gap-[0.35em]">
                  <span className="size-[0.7em] rounded-full" style={{ background: markerColor({ id: "", x: 0, y: 0, kind: "driver", status: s }, P) }} />
                  {t(`presentations.map.status.${s}`)}
                </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </figure>
  )
}
