"use client"

import { useCallback, useState } from "react"
import {
  FileCodeIcon,
  FileDownIcon,
  FileImageIcon,
  FileTextIcon,
  FileTypeIcon,
  HashIcon,
} from "lucide-react"

import { ContextMenuItem } from "@/components/ui/context-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { noteToHtml } from "@/lib/notes/export/html"
import { markdownToTxt } from "@/lib/notes/export/txt"

/*
Note export: Markdown, HTML, PDF, Word (.docx), PNG, plain text — the set from
mark-it-down's note context menu.

Where each one runs, and why:
  markdown   trivial: the body as authored
  text       ported txt exporter, pure
  html       ported render + inlined styles, fully self-contained
  png        html-to-image against the live reading pane
  docx       the `docx` library, loaded on demand — it is large and most
             sessions never export one
  pdf        POST to /api/notes/export/pdf, which prints the exported HTML
             through the presentations' existing puppeteer pipeline. Doing it
             server-side is what makes the PDF match the reading pane instead
             of being redrawn by a second engine.
*/

export type ExportFormat = "markdown" | "html" | "pdf" | "docx" | "png" | "text"

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Strip characters a filesystem or a Content-Disposition header would choke on. */
export function safeFilename(title: string): string {
  return (
    title
      .replace(/[\r\n"\\]/g, "")
      .replace(/[/\\?%*:|<>]/g, "-")
      .slice(0, 80)
      .trim() || "note"
  )
}

export interface NoteExportInput {
  title: string
  markdown: string
  theme?: string | null
  dir?: "ltr" | "rtl" | "auto"
  /** The rendered pane, for PNG. */
  surface?: HTMLElement | null
}

export function useNoteExport(input: NoteExportInput) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState("")

  const run = useCallback(
    async (format: ExportFormat) => {
      const base = safeFilename(input.title)
      setBusy(format)
      setError("")
      try {
        switch (format) {
          case "markdown":
            download(`${base}.md`, new Blob([input.markdown], { type: "text/markdown;charset=utf-8" }))
            break
          case "text":
            download(`${base}.txt`, new Blob([markdownToTxt(input.markdown)], { type: "text/plain;charset=utf-8" }))
            break
          case "html": {
            const html = noteToHtml(input.markdown, { title: input.title, theme: input.theme, dir: input.dir })
            download(`${base}.html`, new Blob([html], { type: "text/html;charset=utf-8" }))
            break
          }
          case "png": {
            if (!input.surface) throw new Error("nothing to capture")
            const { toBlob } = await import("html-to-image")
            const blob = await toBlob(input.surface, {
              pixelRatio: 2,
              backgroundColor: getComputedStyle(input.surface).backgroundColor,
            })
            if (!blob) throw new Error("image export produced nothing")
            download(`${base}.png`, blob)
            break
          }
          case "docx": {
            // Loaded on demand: docx is heavy and rarely needed.
            const { markdownToDocx } = await import("@/lib/notes/export/docx")
            const buf = await markdownToDocx(input.markdown)
            download(
              `${base}.docx`,
              new Blob([new Uint8Array(buf)], {
                type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              }),
            )
            break
          }
          case "pdf": {
            const res = await fetch("/api/notes/export/pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                markdown: input.markdown,
                title: input.title,
                theme: input.theme ?? null,
                dir: input.dir ?? "auto",
              }),
            })
            if (!res.ok) {
              // Surface the server's reason — a silent failure here leaves the
              // user with no idea whether the export is still running.
              const detail = await res.json().catch(() => ({}))
              throw new Error(detail.error || `PDF export failed (${res.status})`)
            }
            download(`${base}.pdf`, await res.blob())
            break
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export failed")
      } finally {
        setBusy(null)
      }
    },
    [input],
  )

  return { run, busy, error }
}

const ITEMS: { format: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { format: "markdown", label: "Export Markdown", icon: <HashIcon className="size-4" /> },
  { format: "html", label: "Export HTML", icon: <FileCodeIcon className="size-4" /> },
  { format: "pdf", label: "Export PDF", icon: <FileDownIcon className="size-4" /> },
  { format: "docx", label: "Export Word (.docx)", icon: <FileTypeIcon className="size-4" /> },
  { format: "png", label: "Export PNG", icon: <FileImageIcon className="size-4" /> },
  { format: "text", label: "Export plain text", icon: <FileTextIcon className="size-4" /> },
]

/**
 * The same actions as DropdownMenuItems, for composing into an existing menu
 * (the note editor already has one, and a second trigger beside it would be
 * clutter). Errors surface as an inline item because a dropdown closes on
 * select and a toast elsewhere would be missed.
 */
export function NoteExportItems({ input }: { input: NoteExportInput }) {
  const { run, busy, error } = useNoteExport(input)
  return (
    <>
      {ITEMS.map((item) => (
        <DropdownMenuItem
          key={item.format}
          disabled={busy !== null}
          // Keep the menu open while an export runs so the "…" is visible.
          closeOnClick={false}
          onClick={() => run(item.format)}
        >
          {item.icon}
          {item.label}
          {busy === item.format ? <span className="ms-auto text-xs text-grid-muted">…</span> : null}
        </DropdownMenuItem>
      ))}
      {error ? <p className="px-2 py-1 text-xs text-grid-danger">{error}</p> : null}
    </>
  )
}

/**
 * The same actions as ContextMenuItems, for right-click menus (the desktop
 * note row uses one). Shares useNoteExport with the dropdown variant so the
 * two surfaces cannot produce different files.
 */
export function NoteExportContextItems({ input }: { input: NoteExportInput }) {
  const { run, busy, error } = useNoteExport(input)
  return (
    <>
      {ITEMS.map((item) => (
        <ContextMenuItem
          key={item.format}
          disabled={busy !== null}
          closeOnClick={false}
          onClick={() => run(item.format)}
        >
          {item.icon}
          {item.label}
          {busy === item.format ? <span className="ms-auto text-xs text-grid-muted">…</span> : null}
        </ContextMenuItem>
      ))}
      {error ? <p className="px-2 py-1 text-xs text-grid-danger">{error}</p> : null}
    </>
  )
}

export function NoteExportMenu({ input }: { input: NoteExportInput }) {
  const { run, busy, error } = useNoteExport(input)
  return (
    <div role="menu" className="min-w-56 rounded-md border border-line bg-grid-card py-1 text-sm">
      {ITEMS.map((item) => (
        <button
          key={item.format}
          type="button"
          role="menuitem"
          disabled={busy !== null}
          onClick={() => run(item.format)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-grid-fg hover:bg-grid-soft disabled:opacity-50"
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          {busy === item.format ? <span className="text-xs text-grid-muted">…</span> : null}
        </button>
      ))}
      {error ? <p className="px-3 py-1.5 text-xs text-grid-danger">{error}</p> : null}
    </div>
  )
}
