"use client"

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "cn"

import { parsePath, type Path } from "@/lib/presentations/edit-path"

/*
Editing in place. The viewers (slide, workflow, screen, report, page) print their text
through <Tx>. With no editor around, <Tx> is the text and nothing else, so shared links and
exports render exactly as before. Inside the owner's editor an <EditProvider> turns every
<Tx> into a field you type in, bound to the content by its path: what you edit is the real
rendered document, not a form beside it.

Paths are relative: a viewer names the field inside its own block ("steps.2.title") and
<EditScope> prefixes where that block sits ("slides.4", "sections.1.blocks.0", "visual").
*/

export type EditApi = {
  /** Writes one field. */
  set: (path: Path, value: string) => void
  /** Enter / Backspace-on-empty inside a list item: add after, or remove. */
  listKey: (listPath: Path, index: number, key: "enter" | "backspace") => void
  /** The field that has the caret (the properties panel follows it). */
  focus: (path: Path) => void
  /** Paths with a validation error, as "a.0.b" keys, to mark them on the canvas. */
  invalid: Map<string, string>
}

type Ctx = { api: EditApi; prefix: Path }
const EditCtx = createContext<Ctx | null>(null)

export function EditProvider({ api, prefix, children }: { api: EditApi | null; prefix: Path; children: ReactNode }) {
  const key = prefix.join(".")
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the prefix is compared by value
  const value = useMemo(() => (api ? { api, prefix } : null), [api, key])
  return <EditCtx.Provider value={value}>{children}</EditCtx.Provider>
}

/** Narrows the path for the children: <EditScope at="parts.2">. A no-op outside the editor. */
export function EditScope({ at, children }: { at: string; children: ReactNode }) {
  const ctx = useContext(EditCtx)
  const value = useMemo(() => (ctx ? { api: ctx.api, prefix: [...ctx.prefix, ...parsePath(at)] } : null), [ctx, at])
  if (!ctx) return <>{children}</>
  return <EditCtx.Provider value={value}>{children}</EditCtx.Provider>
}

/** Turns editing off below (thumbnails, embedded pages). */
export function NoEdit({ children }: { children: ReactNode }) {
  return <EditCtx.Provider value={null}>{children}</EditCtx.Provider>
}

export function useEditing(): boolean {
  return useContext(EditCtx) !== null
}

/** Renders its children when the value is set — or always in the editor, so an empty optional field can be filled. */
export function IfSet({ v, children }: { v: unknown; children: ReactNode }) {
  const editing = useEditing()
  return v || editing ? <>{children}</> : null
}

const humanize = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

function Editable({
  ctx,
  p,
  v,
  list,
  multiline,
  placeholder,
  className,
  onDone,
  onStart,
  autoFocus,
}: {
  ctx: Ctx
  p: string
  v: string
  list?: { path: string; index: number }
  multiline?: boolean
  placeholder?: string
  className?: string
  onDone?: () => void
  onStart?: () => void
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const path = useMemo(() => [...ctx.prefix, ...parsePath(p)], [ctx.prefix, p])
  const key = path.join(".")
  const error = ctx.api.invalid.get(key)

  // The DOM owns the text while you type; an outside change (undo, the panel) is written in.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.textContent !== v) el.textContent = v
  }, [v])
  useLayoutEffect(() => {
    if (!autoFocus || !ref.current) return
    ref.current.focus()
    const sel = window.getSelection()
    sel?.selectAllChildren(ref.current)
    sel?.collapseToEnd()
  }, [autoFocus])

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Escape") {
      e.currentTarget.blur()
      return
    }
    if (e.key === "Enter") {
      if (multiline) return // markdown source: a new line
      e.preventDefault()
      if (list) ctx.api.listKey([...ctx.prefix, ...parsePath(list.path)], list.index, "enter")
      else e.currentTarget.blur()
      return
    }
    if (e.key === "Backspace" && list && (e.currentTarget.textContent ?? "") === "") {
      e.preventDefault()
      ctx.api.listKey([...ctx.prefix, ...parsePath(list.path)], list.index, "backspace")
    }
  }

  return (
    <span
      ref={ref}
      // plaintext-only: no pasted markup, no <div> per line. (Chrome, Safari, Firefox 136+.)
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline || undefined}
      aria-label={placeholder}
      aria-invalid={error ? true : undefined}
      title={error}
      spellCheck
      data-edit-path={key}
      data-placeholder={placeholder}
      className={cn("pres-edit", multiline && "pres-edit-block", className)}
      onInput={(e) => ctx.api.set(path, (e.currentTarget.textContent ?? "").replace(/\u00a0/g, " "))}
      onFocus={() => {
        ctx.api.focus(path)
        onStart?.()
      }}
      onBlur={onDone}
      onKeyDown={onKeyDown}
      // A field inside a link or a button must not trigger it.
      onClick={(e) => e.stopPropagation()}
    />
  )
}

/**
 * One text field of the content. `p` is its path inside the current scope; `list` makes
 * Enter add an item after it and Backspace on an empty one remove it.
 */
export function Tx({
  p,
  v,
  list,
  multiline,
  placeholder,
  className,
}: {
  p: string
  v?: string | null
  list?: { path: string; index: number }
  /** Keeps line breaks (code). */
  multiline?: boolean
  placeholder?: string
  className?: string
}) {
  const ctx = useContext(EditCtx)
  if (!ctx) return <>{v ?? ""}</>
  return <Editable ctx={ctx} p={p} v={v ?? ""} list={list} multiline={multiline} className={className} placeholder={placeholder ?? humanize(String(parsePath(p).filter((k) => typeof k === "string").pop() ?? ""))} />
}

/**
 * A markdown field. Readers get the rendered children. In the editor a click swaps the
 * rendering for its source, typed in place; leaving the field renders it again.
 */
export function TxMd({ p, raw, placeholder, className, children }: { p: string; raw?: string | null; placeholder?: string; className?: string; children: ReactNode }) {
  const ctx = useContext(EditCtx)
  const [open, setOpen] = useState(false)
  if (!ctx) return <>{children}</>
  const label = placeholder ?? humanize(String(parsePath(p).filter((k) => typeof k === "string").pop() ?? ""))
  if (open || !raw) {
    return (
      <div className={className}>
        <Editable ctx={ctx} p={p} v={raw ?? ""} multiline placeholder={label} autoFocus={open && !!raw} onStart={() => setOpen(true)} onDone={() => setOpen(false)} />
      </div>
    )
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className="pres-edit-md"
      data-edit-path={[...ctx.prefix, ...parsePath(p)].join(".")}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(true)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setOpen(true)
        }
      }}
    >
      {children}
    </div>
  )
}
