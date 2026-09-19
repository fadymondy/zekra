"use client"

import { Component, memo, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { CopyIcon, GripVerticalIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { cn } from "cn"

import { ITEM_TEMPLATES, localized } from "@/lib/presentations/templates"
import type { Block, Kind, PageContent, PageSection, Slide } from "@/lib/presentations/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NoEdit } from "../../edit"
import { PagePreview } from "../../page-preview"
import { PresTheme } from "../../pres-theme"
import { BlockView } from "../../report-view"
import { SlideView } from "../../slide"

type Obj = Record<string, unknown>
type T = (key: string, vars?: Record<string, string | number>) => string

/*
A real rendering at a fixed design size, scaled to whatever width it is given — a slide
thumbnail is the slide itself (960 × 540), not a drawing of it. The scale is measured from
the box, and the origin is always the left corner so it is the same in RTL.
*/
export function Scaled({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={box} dir="ltr" className={cn("relative w-full overflow-hidden", className)} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden inert>
      {scale ? (
        <div className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
          <NoEdit>{children}</NoEdit>
        </div>
      ) : null}
    </div>
  )
}

const LABELS = { missingEmbed: "", openPage: "" }

export const SlideThumb = memo(function SlideThumb({ slide, dir, embeds }: { slide: Slide; dir: "ltr" | "rtl"; embeds: Record<string, { style: string; content: PageContent }> }) {
  return (
    <Scaled width={960} height={540} className="rounded-md border bg-card">
      <PresTheme className="size-full">
        <section dir={dir} className="pres-root pres-slide size-full overflow-hidden bg-card p-[4%]">
          <Safe>
            <SlideView slide={slide} embeds={embeds} dir={dir} labels={LABELS} />
          </Safe>
        </section>
      </PresTheme>
    </Scaled>
  )
})

/** A half-typed item can be shaped wrongly; a thumbnail must not take the editor down with it. */
function Safe({ children }: { children: ReactNode }) {
  return <Boundary>{children}</Boundary>
}

export class Boundary extends Component<{ children: ReactNode; fallback?: ReactNode; resetKey?: unknown }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(prev: { resetKey?: unknown; children: ReactNode }) {
    if (this.state.failed && (prev.resetKey !== this.props.resetKey || prev.children !== this.props.children)) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

function TemplateThumb({ kind, item, dir, locale }: { kind: Kind; item: Obj; dir: "ltr" | "rtl"; locale: string }) {
  if (kind === "deck") return <SlideThumb slide={item as unknown as Slide} dir={dir} embeds={{}} />
  if (item.type === "scene") {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
        <SparklesIcon className="size-8" aria-hidden />
      </div>
    )
  }
  return (
    <Scaled width={960} height={540} className="rounded-md border bg-background">
      <PresTheme className="size-full overflow-hidden">
        {kind === "report" ? (
          <div dir={dir} className="pres-root p-8 text-lg">
            <BlockView block={item as unknown as Block} locale={locale} dir={dir} />
          </div>
        ) : (
          <PagePreview content={{ title: "", sections: [item as unknown as PageSection] }} style="minimal" dir={dir} compact still />
        )}
      </PresTheme>
    </Scaled>
  )
}

/** "Add a slide / block / section": every template of the kind, rendered, in the document's language. */
export function Gallery({
  open,
  onOpenChange,
  kind,
  title,
  locale,
  dir,
  t,
  disabled,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  kind: Kind
  title: string
  locale: string
  dir: "ltr" | "rtl"
  t: T
  /** Types that cannot be added now, with the reason. */
  disabled?: Record<string, string>
  onPick: (item: Obj) => void
}) {
  const types = Object.keys(ITEM_TEMPLATES[kind])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl" data-testid="gallery">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("presentations.editor.galleryHelp")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {types.map((type) => {
              const item = localized(ITEM_TEMPLATES[kind][type], locale)
              const why = disabled?.[type]
              return (
                <button
                  key={type}
                  type="button"
                  disabled={!!why}
                  title={why}
                  data-testid={`template-${type}`}
                  onClick={() => {
                    onPick(item)
                    onOpenChange(false)
                  }}
                  className="group grid gap-1.5 rounded-lg border p-1.5 text-start outline-none hover:border-brand hover:bg-brand/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <TemplateThumb kind={kind} item={item} dir={dir} locale={locale} />
                  <span className="px-1 text-xs font-medium">{t(`presentations.type.${type}`)}</span>
                  {why ? <span className="px-1 text-[10px] text-muted-foreground">{why}</span> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export type RailItem = {
  key: string
  /** Path of the item in the content. */
  path: (string | number)[]
  /** The list it can be reordered within, and its index there. */
  listPath: (string | number)[]
  index: number
  label: string
  type?: string
  depth?: number
  invalid?: boolean
  thumb?: ReactNode
}

/**
 * The left rail: slides as thumbnails, or a report/page outline. Click selects, drag
 * reorders within the same list, and the keyboard does the same (Alt+↑/↓ moves, Delete
 * removes, Ctrl/⌘+D duplicates).
 */
export function Rail({
  items,
  selected,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  t,
  horizontal,
}: {
  items: RailItem[]
  selected: string
  onSelect: (item: RailItem) => void
  onMove: (item: RailItem, to: number) => void
  onDuplicate: (item: RailItem) => void
  onRemove: (item: RailItem) => void
  t: T
  horizontal?: boolean
}) {
  const [drag, setDrag] = useState<RailItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const sameList = (a: RailItem, b: RailItem) => a.listPath.join(".") === b.listPath.join(".")
  return (
    <ol className={cn("flex gap-2", horizontal ? "flex-row overflow-x-auto p-2" : "flex-col p-2")} data-testid="rail">
      {items.map((it) => {
        const active = it.key === selected
        return (
          <li
            key={it.key}
            data-testid="rail-item"
            data-selected={active || undefined}
            draggable
            onDragStart={(e) => {
              setDrag(it)
              e.dataTransfer.effectAllowed = "move"
              e.dataTransfer.setData("text/plain", it.key)
            }}
            onDragEnd={() => {
              setDrag(null)
              setOver(null)
            }}
            onDragOver={(e) => {
              if (!drag || !sameList(drag, it)) return
              e.preventDefault()
              setOver(it.key)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag && sameList(drag, it) && drag.index !== it.index) onMove(drag, it.index)
              setDrag(null)
              setOver(null)
            }}
            className={cn("group relative shrink-0", horizontal && "w-40", over === it.key && drag && drag.key !== it.key && "before:absolute before:-top-1.5 before:right-0 before:left-0 before:h-0.5 before:rounded before:bg-brand")}
            style={it.depth ? { paddingInlineStart: `${it.depth * 0.75}rem` } : undefined}
          >
            <div
              role="button"
              tabIndex={0}
              aria-current={active || undefined}
              aria-label={`${it.index + 1}. ${it.label}`}
              onClick={() => onSelect(it)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelect(it)
                } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault()
                  onMove(it, it.index + (e.key === "ArrowUp" ? -1 : 1))
                } else if (e.key === "Delete") {
                  e.preventDefault()
                  onRemove(it)
                } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
                  e.preventDefault()
                  onDuplicate(it)
                }
              }}
              className={cn(
                "grid cursor-pointer gap-1 rounded-lg border-2 p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-brand bg-brand/5" : "border-transparent hover:bg-muted",
                it.invalid && "border-destructive/70",
                drag?.key === it.key && "opacity-40",
              )}
            >
              {it.thumb}
              <div className="flex min-w-0 items-center gap-1 text-xs">
                <GripVerticalIcon className="size-3 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
                <span className="shrink-0 text-muted-foreground tabular-nums">{it.index + 1}</span>
                {it.type && !it.thumb ? <Badge variant="secondary">{t(`presentations.type.${it.type}`)}</Badge> : null}
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {it.label}
                </span>
                {it.invalid ? <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-label={t("presentations.editor.hasErrors")} /> : null}
                <span className={cn("flex shrink-0", !active && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}>
                  <Button variant="ghost" size="icon-xs" onClick={(e) => (e.stopPropagation(), onDuplicate(it))} aria-label={t("presentations.editor.duplicate")}>
                    <CopyIcon />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={(e) => (e.stopPropagation(), onRemove(it))} aria-label={t("presentations.remove")}>
                    <Trash2Icon />
                  </Button>
                </span>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function AddButton({ label, onClick, testid }: { label: string; onClick: () => void; testid?: string }) {
  return (
    <Button variant="outline" size="sm" className="w-full" onClick={onClick} data-testid={testid}>
      <PlusIcon />
      {label}
    </Button>
  )
}
