"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CopyIcon, DownloadIcon, HashIcon, ImageIcon } from "lucide-react"

/*
Actions for a rendered code block: copy, download, export PNG, line numbers.

The markdown body is injected as HTML (see note-markdown.tsx), so the blocks
are plain DOM, not React children. Rather than mounting a React root per block
— a long note can hold dozens — one delegated listener on the container spots
clicks on [data-zk-code-menu] and positions a single floating menu.
*/

type MenuState = { figure: HTMLElement; x: number; y: number } | null

const codeOf = (figure: HTMLElement) =>
  figure.querySelector("code")?.getAttribute("data-code") ?? ""

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  // Revoking synchronously can cancel the download in some browsers; defer.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Build or remove the line-number gutter for one block. */
function toggleLineNumbers(figure: HTMLElement) {
  const pre = figure.querySelector("pre")
  const code = figure.querySelector("code")
  if (!pre || !code) return
  const on = figure.getAttribute("data-lines") === "on"
  if (on) {
    figure.removeAttribute("data-lines")
    pre.querySelector(".zk-gutter")?.remove()
    return
  }
  // Count from the ORIGINAL source: the highlighted markup contains spans that
  // cross newlines, so counting its children would give the wrong total.
  const lines = (code.getAttribute("data-code") ?? "").split("\n").length
  const gutter = document.createElement("span")
  gutter.className = "zk-gutter"
  gutter.setAttribute("aria-hidden", "true")
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n")
  pre.insertBefore(gutter, code)
  figure.setAttribute("data-lines", "on")
}

export function useCodeActions(containerRef: React.RefObject<HTMLElement | null>) {
  const [menu, setMenu] = useState<MenuState>(null)
  const [toast, setToast] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.("[data-zk-code-menu]")
      if (!btn) return
      e.preventDefault()
      const figure = btn.closest(".zk-code") as HTMLElement | null
      if (!figure) return
      const r = btn.getBoundingClientRect()
      setMenu({ figure, x: r.right, y: r.bottom + 4 })
    }
    el.addEventListener("click", onClick)
    return () => el.removeEventListener("click", onClick)
  }, [containerRef])

  // Dismiss on outside click, Escape, scroll or resize — the menu is anchored
  // to viewport coordinates, so it must not linger once those change.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [menu])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 1600)
  }, [])

  const run = useCallback(
    async (action: "copy" | "download" | "png" | "lines") => {
      if (!menu) return
      const { figure } = menu
      setMenu(null)
      const code = codeOf(figure)
      const name = figure.getAttribute("data-filename") || "snippet.txt"

      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(code)
          flash("Copied")
        } catch {
          // Clipboard is permission-gated and unavailable on insecure origins;
          // say so rather than failing silently.
          flash("Clipboard blocked")
        }
        return
      }
      if (action === "download") {
        download(name, new Blob([code], { type: "text/plain;charset=utf-8" }))
        return
      }
      if (action === "lines") {
        toggleLineNumbers(figure)
        return
      }
      // PNG: loaded on demand so the rasteriser stays out of the page bundle.
      try {
        const { toBlob } = await import("html-to-image")
        const blob = await toBlob(figure, {
          pixelRatio: 2,
          backgroundColor: getComputedStyle(figure).backgroundColor,
        })
        if (!blob) throw new Error("no blob")
        download(name.replace(/\.[^.]+$/, "") + ".png", blob)
      } catch {
        flash("PNG export failed")
      }
    },
    [menu, flash],
  )

  const element = (
    <>
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-44 -translate-x-full rounded-md border border-line bg-grid-card py-1 text-sm shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <Item icon={<CopyIcon className="size-4" />} label="Copy" hint="⌘C" onClick={() => run("copy")} />
          <Item icon={<DownloadIcon className="size-4" />} label="Download as file" onClick={() => run("download")} />
          <Item icon={<ImageIcon className="size-4" />} label="Export as PNG" onClick={() => run("png")} />
          <div className="my-1 border-t border-line" />
          <Item
            icon={<HashIcon className="size-4" />}
            label={menu.figure.getAttribute("data-lines") === "on" ? "Hide line numbers" : "Show line numbers"}
            onClick={() => run("lines")}
          />
        </div>
      ) : null}
      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-grid-card px-3 py-1.5 text-sm shadow-lg">
          {toast}
        </div>
      ) : null}
    </>
  )

  return element
}

function Item({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-grid-fg hover:bg-grid-soft"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {hint ? <span className="font-mono text-xs text-grid-muted">{hint}</span> : null}
    </button>
  )
}
