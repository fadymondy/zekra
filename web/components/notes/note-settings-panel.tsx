"use client"

import { useCallback, useEffect, useState } from "react"

import {
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  FONT_SIZE_RANGE,
  MAX_WIDTH_RANGE,
  type AutoSave,
  type NoteSettings,
  getSettings,
  setSettings,
  subscribeSettings,
  watchExternalSettings,
} from "@/lib/notes/note-settings"
import { ThemePicker } from "./theme-picker"

/*
The Typography and Editor panels from mark-it-down's settings screen, plus the
reading-theme picker.

Copy is kept close to the original so the two products read the same to anyone
migrating, except where Zekra's behaviour genuinely differs (the max-width
default — see below).
*/

export function useNoteSettings() {
  const [settings, setLocal] = useState<NoteSettings>(DEFAULT_SETTINGS)

  /*
  Subscribe rather than hold private state. Every caller previously owned an
  isolated useState, so the settings panel wrote to storage and the note
  surface never heard about it — a theme or font change did nothing until a
  reload. Reported as "it's not even reflected in the UI".

  Reading after mount also keeps SSR honest: localStorage does not exist on the
  server, and seeding useState from it would desync the first client render.
  */
  useEffect(() => {
    setLocal(getSettings())
    const unsubscribe = subscribeSettings(setLocal)
    const unwatch = watchExternalSettings()
    return () => {
      unsubscribe()
      unwatch()
    }
  }, [])

  const update = useCallback((patch: Partial<NoteSettings>) => {
    // Patch the STORE, not local state, so every other reader is told.
    setSettings({ ...getSettings(), ...patch })
  }, [])

  return { settings, update }
}

export function NoteSettingsPanel() {
  const { settings, update } = useNoteSettings()

  return (
    <div className="space-y-8">
      <Panel title="Typography" description="Reading font and size for the preview pane.">
        <Row label="Font family" hint="Used for body text in the preview.">
          <select
            value={settings.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value as NoteSettings["fontFamily"] })}
            className="h-9 rounded-md border border-line bg-grid-bg px-2 text-sm text-grid-fg"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Body font size" hint="Larger sizes are easier on the eyes for long-form reading.">
          <Slider
            min={FONT_SIZE_RANGE.min}
            max={FONT_SIZE_RANGE.max}
            value={settings.fontSize}
            onChange={(n) => update({ fontSize: n })}
            format={(n) => `${n}px`}
          />
        </Row>

        <Row
          label="Preview max-width"
          // Deliberately different from mark-it-down, which defaults to 760px.
          // A width cap was removed from this app on explicit request, so it is
          // opt-in here and the copy says what 0 means.
          hint="Cap the column width of the rendered markdown. Full width at 0."
        >
          <Slider
            min={MAX_WIDTH_RANGE.min}
            max={MAX_WIDTH_RANGE.max}
            step={MAX_WIDTH_RANGE.step}
            value={settings.maxWidth}
            onChange={(n) => update({ maxWidth: n })}
            format={(n) => (n === 0 ? "Full width" : `${n}px`)}
          />
        </Row>
      </Panel>

      <Panel title="Editor" description="Editing behavior in the split and edit panes.">
        <Row
          label="Word wrap"
          hint="Soft-wrap long lines in the editor textarea. Off shows a horizontal scrollbar instead."
        >
          <Check checked={settings.wordWrap} onChange={(v) => update({ wordWrap: v })} label="Word wrap" />
        </Row>

        <Row
          label="Show line numbers in code blocks"
          hint="Adds a left-side gutter to every fenced code block in the rendered preview."
        >
          <Check
            checked={settings.lineNumbers}
            onChange={(v) => update({ lineNumbers: v })}
            label="Show line numbers"
          />
        </Row>

        <Row
          label="Auto-save"
          hint="Off — manual Cmd/Ctrl+S only. On blur — save when the editor loses focus. Every 5s — periodic background save."
        >
          <Segmented
            value={settings.autoSave}
            onChange={(v) => update({ autoSave: v })}
            options={[
              { id: "off", label: "Off" },
              { id: "blur", label: "On blur" },
              { id: "interval", label: "Every 5s" },
            ]}
          />
        </Row>
      </Panel>

      {/* Description corrected when theming moved from the note surface to the
          whole app — it previously promised the opposite of what now happens. */}
      <Panel title="Reading theme" description="Repaints the whole app. Pick none to keep Zekra's own palette.">
        <ThemePicker value={settings.theme} onChange={(id) => update({ theme: id })} />
      </Panel>
    </div>
  )
}

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line">
      <header className="border-b border-line bg-grid-soft px-4 py-3">
        <h2 className="font-medium text-grid-fg">{title}</h2>
        <p className="text-sm text-grid-muted">{description}</p>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-grid-fg">{label}</div>
        <p className="text-xs text-grid-muted">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  format,
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (n: number) => void
  format: (n: number) => string
}) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-48 accent-grid-action"
      />
      {/* Tabular numerals so the label does not jitter as the value changes. */}
      <span className="w-20 text-end font-mono text-xs text-grid-muted tabular-nums">{format(value)}</span>
    </label>
  )
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 accent-grid-action"
    />
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
}) {
  return (
    <div role="radiogroup" className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-9 rounded-md border px-4 text-sm transition ${
            value === o.id
              ? "border-grid-action bg-grid-action text-grid-on-action"
              : "border-line text-grid-fg hover:bg-grid-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type { AutoSave }
