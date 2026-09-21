"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CopyIcon, FileJsonIcon, FileSpreadsheetIcon, ImageIcon, SheetIcon, TableIcon, XIcon } from "lucide-react"

import { compare, toCsv, toJson, toMarkdown, type Rows } from "./table-export.ts"

/*
Behaviour for the interactive tables emitted by lib/markdown/table.ts: filter,
sort, and export (Copy as Markdown, PNG, CSV, XLSX, JSON).

As with code-actions, the table is plain DOM inside a dangerouslySetInnerHTML
body, so everything is delegated from one listener on the container rather than
mounting a React root per table.

Filter and sort both read the data-rows payload — the plain-text projection of
the table — and rewrite <tbody> from it. Scraping the DOM instead would sort by
rendered HTML (so "<strong>a</strong>" sorts under "<") and would leak markup
into exports.
*/

type MenuState = { figure: HTMLElement; x: number; y: number } | null

function readRows(figure: HTMLElement): Rows {
  try {
    return JSON.parse(figure.getAttribute("data-rows") ?? "") as Rows
  } catch {
    return { headers: [], rows: [] }
  }
}

/** Sort state lives on the element so it survives re-renders of the menu. */
function sortState(figure: HTMLElement) {
  const col = figure.getAttribute("data-sort-col")
  const dir = figure.getAttribute("data-sort-dir")
  return { col: col === null ? null : Number(col), dir: dir === "desc" ? "desc" : "asc" }
}

/** Recompute <tbody> from the payload, applying the current filter and sort. */
function apply(figure: HTMLElement) {
  const { rows } = readRows(figure)
  const q = (figure.getAttribute("data-filter") ?? "").trim().toLowerCase()
  const { col, dir } = sortState(figure)

  let view = rows
  if (q) view = view.filter((r) => r.some((c) => c.toLowerCase().includes(q)))
  if (col !== null) {
    // Copy before sorting: the payload is the source of truth and must not be
    // mutated, or clearing the filter would return rows in sorted order.
    view = [...view].sort((x, y) => (dir === "desc" ? -1 : 1) * compare(x[col] ?? "", y[col] ?? ""))
  }

  const tbody = figure.querySelector("tbody")
  if (tbody) {
    // Filtering rebuilds from plain text, so inline markup is lost in filtered
    // views. Accepted: the alternative is keeping a parallel DOM index of
    // original cells, and a filtered table is a data view, not prose.
    tbody.innerHTML = view
      .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("")
  }
  const count = figure.querySelector("[data-zk-table-count]")
  if (count) count.textContent = `${view.length} ${view.length === 1 ? "row" : "rows"}`

  figure.querySelectorAll<HTMLElement>("[data-zk-table-sort]").forEach((btn) => {
    const i = Number(btn.getAttribute("data-zk-table-sort"))
    btn.setAttribute("data-active", col === i ? dir : "")
  })
  return view
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}


export function useTableActions(containerRef: React.RefObject<HTMLElement | null>) {
  const [menu, setMenu] = useState<MenuState>(null)
  const [toast, setToast] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)

  const flash = useCallback((m: string) => {
    setToast(m)
    setTimeout(() => setToast(""), 1600)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const sortBtn = t?.closest?.("[data-zk-table-sort]")
      if (sortBtn) {
        const figure = sortBtn.closest(".zk-table") as HTMLElement | null
        if (!figure) return
        const i = Number(sortBtn.getAttribute("data-zk-table-sort"))
        const { col, dir } = sortState(figure)
        // Third click on the same column clears the sort, matching the
        // "No sort active" state the menu reports.
        if (col === i && dir === "asc") figure.setAttribute("data-sort-dir", "desc")
        else if (col === i && dir === "desc") {
          figure.removeAttribute("data-sort-col")
          figure.removeAttribute("data-sort-dir")
        } else {
          figure.setAttribute("data-sort-col", String(i))
          figure.setAttribute("data-sort-dir", "asc")
        }
        apply(figure)
        return
      }
      const menuBtn = t?.closest?.("[data-zk-table-menu]")
      if (menuBtn) {
        e.preventDefault()
        const figure = menuBtn.closest(".zk-table") as HTMLElement | null
        if (!figure) return
        const r = menuBtn.getBoundingClientRect()
        setMenu({ figure, x: r.right, y: r.bottom + 4 })
      }
    }

    const onInput = (e: Event) => {
      const input = e.target as HTMLInputElement | null
      if (!input?.matches?.("[data-zk-table-filter]")) return
      const figure = input.closest(".zk-table") as HTMLElement | null
      if (!figure) return
      figure.setAttribute("data-filter", input.value)
      apply(figure)
    }

    el.addEventListener("click", onClick)
    el.addEventListener("input", onInput)
    return () => {
      el.removeEventListener("click", onClick)
      el.removeEventListener("input", onInput)
    }
  }, [containerRef])

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

  const run = useCallback(
    async (action: "md" | "png" | "csv" | "xlsx" | "json" | "clear") => {
      if (!menu) return
      const { figure } = menu
      setMenu(null)
      const data = readRows(figure)

      if (action === "clear") {
        figure.removeAttribute("data-sort-col")
        figure.removeAttribute("data-sort-dir")
        apply(figure)
        return
      }
      if (action === "md") {
        try {
          await navigator.clipboard.writeText(toMarkdown(data))
          flash("Copied as Markdown")
        } catch {
          flash("Clipboard blocked")
        }
        return
      }
      if (action === "csv") {
        const csv = toCsv(data)
        // BOM so Excel opens UTF-8 (Arabic especially) without mojibake.
        download("table.csv", new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
        return
      }
      if (action === "json") {
        download("table.json", new Blob([toJson(data)], { type: "application/json" }))
        return
      }
      if (action === "xlsx") {
        // No spreadsheet writer is bundled. Rather than ship a file named
        // .xlsx that Excel would reject, say so plainly and leave CSV — which
        // Excel opens natively — as the working path.
        flash("XLSX needs a spreadsheet library — use CSV for now")
        return
      }
      try {
        const { toBlob } = await import("html-to-image")
        const blob = await toBlob(figure, {
          pixelRatio: 2,
          backgroundColor: getComputedStyle(figure).backgroundColor,
        })
        if (!blob) throw new Error("no blob")
        download("table.png", blob)
      } catch {
        flash("PNG export failed")
      }
    },
    [menu, flash],
  )

  const sorted = menu ? sortState(menu.figure) : { col: null, dir: "asc" as const }

  const element = (
    <>
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-56 -translate-x-full rounded-md border border-line bg-grid-card py-1 text-sm shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <Item icon={<CopyIcon className="size-4" />} label="Copy as Markdown" onClick={() => run("md")} />
          <Item icon={<ImageIcon className="size-4" />} label="Export as PNG" onClick={() => run("png")} />
          <Item icon={<FileSpreadsheetIcon className="size-4" />} label="Download CSV" onClick={() => run("csv")} />
          <Item icon={<SheetIcon className="size-4" />} label="Download Excel (.xlsx)" onClick={() => run("xlsx")} />
          <Item icon={<FileJsonIcon className="size-4" />} label="Download JSON" onClick={() => run("json")} />
          <div className="my-1 border-t border-line" />
          {sorted.col === null ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-grid-muted">
              <XIcon className="size-4" />
              <span>No sort active</span>
            </div>
          ) : (
            <Item
              icon={<TableIcon className="size-4" />}
              label={`Clear sort (${sorted.dir})`}
              onClick={() => run("clear")}
            />
          )}
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

function Item({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-grid-fg hover:bg-grid-soft"
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  )
}
