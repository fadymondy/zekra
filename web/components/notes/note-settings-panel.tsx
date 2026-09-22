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
import { ThemePicker, type ThemeLabels } from "./theme-picker"

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

/*
Every string this panel shows, so the caller can translate it.

The panel is mounted by the web console (inside next-intl) AND by the Electron
renderer (which has its own tiny i18n and no provider), so it cannot call
useTranslations itself — the same reason NoteTabs takes a `labels` prop. The
defaults below are the English copy, which keeps the web call site short and
means a missing key degrades to English rather than to a blank label.
*/
export interface SettingsLabels extends ThemeLabels {
  typography: string
  typographyHint: string
  fontFamily: string
  fontFamilyHint: string
  fontSize: string
  fontSizeHint: string
  maxWidth: string
  maxWidthHint: string
  fullWidth: string
  editor: string
  editorHint: string
  wordWrap: string
  wordWrapHint: string
  lineNumbers: string
  lineNumbersHint: string
  autoSave: string
  autoSaveHint: string
  autoSaveOff: string
  autoSaveBlur: string
  autoSaveInterval: string
  readingTheme: string
  readingThemeHint: string
}

export const DEFAULT_SETTINGS_LABELS: SettingsLabels = {
  typography: "Typography",
  typographyHint: "Reading font and size for the preview pane.",
  fontFamily: "Font family",
  fontFamilyHint: "Used for body text in the preview.",
  fontSize: "Body font size",
  fontSizeHint: "Larger sizes are easier on the eyes for long-form reading.",
  maxWidth: "Preview max-width",
  // Deliberately different from mark-it-down, which defaults to 760px. A width
  // cap was removed from this app on explicit request, so it is opt-in here and
  // the copy says what 0 means.
  maxWidthHint: "Cap the column width of the rendered markdown. Full width at 0.",
  fullWidth: "Full width",
  editor: "Editor",
  editorHint: "Editing behavior in the split and edit panes.",
  wordWrap: "Word wrap",
  wordWrapHint: "Soft-wrap long lines in the editor textarea. Off shows a horizontal scrollbar instead.",
  lineNumbers: "Show line numbers in code blocks",
  lineNumbersHint: "Adds a left-side gutter to every fenced code block in the rendered preview.",
  autoSave: "Auto-save",
  autoSaveHint: "Off — manual Cmd/Ctrl+S only. On blur — save when the editor loses focus. Every 5s — periodic background save.",
  autoSaveOff: "Off",
  autoSaveBlur: "On blur",
  autoSaveInterval: "Every 5s",
  readingTheme: "Reading theme",
  // Corrected when theming moved from the note surface to the whole app — it
  // previously promised the opposite of what now happens.
  readingThemeHint: "Repaints the whole app. Pick none to keep Zekra's own palette.",
  lightThemes: "Light themes",
  darkThemes: "Dark themes",
  ownPalette: "Use Zekra's own palette",
}

export function NoteSettingsPanel({ labels }: { labels?: Partial<SettingsLabels> }) {
  const { settings, update } = useNoteSettings()
  const l = { ...DEFAULT_SETTINGS_LABELS, ...labels }

  return (
    <div className="space-y-8">
      <Panel title={l.typography} description={l.typographyHint}>
        <Row label={l.fontFamily} hint={l.fontFamilyHint}>
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

        <Row label={l.fontSize} hint={l.fontSizeHint}>
          <Slider
            min={FONT_SIZE_RANGE.min}
            max={FONT_SIZE_RANGE.max}
            value={settings.fontSize}
            onChange={(n) => update({ fontSize: n })}
            format={(n) => `${n}px`}
          />
        </Row>

        <Row label={l.maxWidth} hint={l.maxWidthHint}>
          <Slider
            min={MAX_WIDTH_RANGE.min}
            max={MAX_WIDTH_RANGE.max}
            step={MAX_WIDTH_RANGE.step}
            value={settings.maxWidth}
            onChange={(n) => update({ maxWidth: n })}
            format={(n) => (n === 0 ? l.fullWidth : `${n}px`)}
          />
        </Row>
      </Panel>

      <Panel title={l.editor} description={l.editorHint}>
        <Row label={l.wordWrap} hint={l.wordWrapHint}>
          <Check checked={settings.wordWrap} onChange={(v) => update({ wordWrap: v })} label={l.wordWrap} />
        </Row>

        <Row label={l.lineNumbers} hint={l.lineNumbersHint}>
          <Check checked={settings.lineNumbers} onChange={(v) => update({ lineNumbers: v })} label={l.lineNumbers} />
        </Row>

        <Row label={l.autoSave} hint={l.autoSaveHint}>
          <Segmented
            value={settings.autoSave}
            onChange={(v) => update({ autoSave: v })}
            options={[
              { id: "off", label: l.autoSaveOff },
              { id: "blur", label: l.autoSaveBlur },
              { id: "interval", label: l.autoSaveInterval },
            ]}
          />
        </Row>
      </Panel>

      <Panel title={l.readingTheme} description={l.readingThemeHint}>
        <ThemePicker value={settings.theme} onChange={(id) => update({ theme: id })} labels={l} />
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
        // Pinned LTR even in Arabic. A range input mirrors under dir="rtl", so
        // the maximum lands on the left and dragging towards the start edge
        // makes the number go up — which reads wrong for a magnitude like px.
        // Numerals are western here for the same reason (tabular-nums below).
        dir="ltr"
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
