"use client"

import { useEffect } from "react"

import { applyThemeToDocument, groupedThemes, themeById } from "@/lib/markdown/themes/apply"
import type { ThemeDefinition } from "@/lib/markdown/themes/themes"

/*
The reading-theme picker: a grid of swatch cards grouped into LIGHT / DARK,
matching mark-it-down's settings screen.

Each card previews the palette itself rather than showing a colour chip, so the
choice is legible without applying it — the bars stand in for a heading, an
accented line, body text and a muted line.

The selection itself lives in lib/notes/note-settings alongside the Typography
and Editor preferences (MH-214) — this file only renders the choice and emits
the CSS. It briefly owned its own localStorage key; that key is migrated on
first load rather than left to strand an existing preference.
*/

/**
 * Applies the chosen theme to the WHOLE app.
 *
 * It was originally scoped to the note surface to protect Zekra's brand
 * palette, but the product call is that a reading theme repaints everything —
 * so this writes the variables onto documentElement instead. Rendering
 * nothing: the effect is the entire point.
 */
export function NoteThemeStyle({ id }: { id: string | null }) {
  useEffect(() => {
    applyThemeToDocument(themeById(id))
  }, [id])
  return null
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const { light, dark } = groupedThemes()
  return (
    <div className="space-y-6">
      <Group title="Light themes" themes={light} value={value} onChange={onChange} />
      <Group title="Dark themes" themes={dark} value={value} onChange={onChange} />
      <button
        type="button"
        onClick={() => onChange(null)}
        className="text-sm text-grid-muted underline underline-offset-4 hover:text-grid-fg"
      >
        Use Zekra&rsquo;s own palette
      </button>
    </div>
  )
}

function Group({
  title,
  themes,
  value,
  onChange,
}: {
  title: string
  themes: ThemeDefinition[]
  value: string | null
  onChange: (id: string) => void
}) {
  return (
    // @container so the grid tracks its CONTAINER, not the viewport. The
    // viewport breakpoints looked right on web and collapsed every card to
    // full width inside the desktop settings column, which is narrower than
    // the sm: breakpoint however wide the window is.
    <section className="@container">
      <h3 className="mb-2 font-mono text-xs tracking-wider text-grid-muted uppercase">{title}</h3>
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
        {themes.map((t) => (
          <Card key={t.id} theme={t} selected={value === t.id} onSelect={() => onChange(t.id)} />
        ))}
      </div>
    </section>
  )
}

function Card({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemeDefinition
  selected: boolean
  onSelect: () => void
}) {
  const p = theme.palette
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`overflow-hidden rounded-md border text-start transition ${
        selected ? "border-grid-action ring-2 ring-grid-action/40" : "border-line hover:border-grid-muted"
      }`}
    >
      {/* Miniature of the palette: heading, accent, body, muted. */}
      <span className="block px-3 py-3" style={{ background: p.bg }}>
        <span className="block h-1.5 w-3/4 rounded-sm" style={{ background: p.fg, opacity: 0.85 }} />
        <span className="mt-1.5 block h-1.5 w-1/3 rounded-sm" style={{ background: p.link }} />
        <span className="mt-1.5 block h-1.5 w-full rounded-sm" style={{ background: p.fgMuted, opacity: 0.45 }} />
        <span className="mt-1.5 block h-1.5 w-1/2 rounded-sm" style={{ background: p.fgMuted, opacity: 0.3 }} />
      </span>
      <span className="flex items-center justify-between gap-2 border-t border-line bg-grid-card px-2 py-1.5">
        <span className="truncate text-xs text-grid-fg">{theme.label}</span>
        <span
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase"
          style={{ background: p.link, color: p.bg }}
        >
          {theme.kind}
        </span>
      </span>
    </button>
  )
}
