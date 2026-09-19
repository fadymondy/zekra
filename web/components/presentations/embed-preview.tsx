"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { cn } from "cn"

import type { PageContent } from "@/lib/presentations/types"
import { Button } from "@/components/ui/button"
import { PagePreview } from "./page-preview"

/*
An embedded page preview on a slide (FM-341 polish): the landing page laid out
at desktop width (1280px) and scaled down to fill the slide, like a
screenshot of its first screen. It never scrolls and takes no input; "Open the
page" opens the page itself (through the deck's share link) in a new tab.
*/
const DESKTOP = 1280

export function EmbedPreview({
  content,
  style,
  dir,
  href,
  openLabel,
  className,
}: {
  content: PageContent
  style: string
  dir: "ltr" | "rtl"
  href?: string
  openLabel: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [boxH, setBoxH] = useState(0)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      setScale(el.clientWidth / DESKTOP)
      setBoxH(el.clientHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={cn("relative flex min-h-[12rem] flex-col", className)}>
      <div
        ref={box}
        data-reveal
        data-embed-preview
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background shadow-sm"
        aria-hidden
        inert
      >
        {scale > 0 ? (
          <div
            className="pointer-events-none absolute top-0 select-none"
            style={{
              width: DESKTOP,
              height: boxH / scale,
              transform: `scale(${scale})`,
              transformOrigin: dir === "rtl" ? "top right" : "top left",
              insetInlineStart: 0,
              right: dir === "rtl" ? 0 : undefined,
              left: dir === "rtl" ? undefined : 0,
            }}
          >
            <PagePreview content={content} style={style} dir={dir} still />
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/90 to-transparent" />
      </div>
      {href ? (
        <div className="absolute inset-x-0 bottom-[max(0.75rem,3cqh)] flex justify-center">
          <Button
            size="lg"
            className="shadow-lg"
            nativeButton={false}
            render={<a href={href} target="_blank" rel="noopener noreferrer" data-open-page />}
          >
            {openLabel}
            <ExternalLinkIcon />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
