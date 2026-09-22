/*
Reader and editor preferences for notes, ported from mark-it-down's settings
screen (Typography + Editor panels).

One store for every note preference, including the reading theme, which until
now lived in its own localStorage key. Keeping them together means the eventual
move to server-side persistence is one migration rather than several.

Persistence is localStorage for the moment. That is deliberate and recorded on
MH-214: inventing a settings API for a handful of values before the shape has
settled would be harder to change than a key swap here.
*/

export const FONT_FAMILIES = [
  { id: 'system', label: 'System', stack: 'var(--grid-font-sans)' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'sans', label: 'Sans', stack: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'mono', label: 'Monospace', stack: 'var(--grid-font-mono)' },
  { id: 'reading', label: 'Reading', stack: '"Iowan Old Style", "Palatino Linotype", Palatino, serif' },
] as const

export type FontFamilyId = (typeof FONT_FAMILIES)[number]['id']
export type AutoSave = 'off' | 'blur' | 'interval'

export interface NoteSettings {
  /** Reading theme id, or null for Zekra's own palette. */
  theme: string | null
  fontFamily: FontFamilyId
  /** Body size in px for the rendered markdown. */
  fontSize: number
  /**
   * Reading column cap in px, or 0 for unconstrained.
   *
   * DEFAULT IS 0 ON PURPOSE. mark-it-down defaults this to 760px, but a
   * reading-width cap was explicitly removed from this app on request ("make
   * the markdown full width") — shipping 760 as the default would silently
   * reintroduce the complaint. The cap is opt-in here.
   */
  maxWidth: number
  wordWrap: boolean
  lineNumbers: boolean
  autoSave: AutoSave
}

export const DEFAULT_SETTINGS: NoteSettings = {
  theme: null,
  fontFamily: 'system',
  fontSize: 15,
  maxWidth: 0,
  wordWrap: true,
  lineNumbers: false,
  autoSave: 'off',
}

export const FONT_SIZE_RANGE = { min: 12, max: 24 } as const
export const MAX_WIDTH_RANGE = { min: 0, max: 1200, step: 20 } as const

const KEY = 'zekra.note-settings'
/** The pre-consolidation key, read once so an existing choice is not lost. */
const LEGACY_THEME_KEY = 'zekra.note-theme'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Validate anything coming out of storage. It is user-writable and may be from
 * an older build, so every field is checked rather than spread blindly — a
 * bad fontSize would otherwise render the pane unusable with no way back.
 */
export function coerceSettings(raw: unknown): NoteSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<NoteSettings>
  const family = FONT_FAMILIES.some((f) => f.id === o.fontFamily) ? (o.fontFamily as FontFamilyId) : DEFAULT_SETTINGS.fontFamily
  const autoSave: AutoSave = o.autoSave === 'blur' || o.autoSave === 'interval' ? o.autoSave : 'off'
  return {
    theme: typeof o.theme === 'string' && o.theme ? o.theme : null,
    fontFamily: family,
    fontSize: Number.isFinite(o.fontSize)
      ? clamp(Number(o.fontSize), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
      : DEFAULT_SETTINGS.fontSize,
    maxWidth: Number.isFinite(o.maxWidth) ? clamp(Number(o.maxWidth), 0, MAX_WIDTH_RANGE.max) : 0,
    wordWrap: typeof o.wordWrap === 'boolean' ? o.wordWrap : DEFAULT_SETTINGS.wordWrap,
    lineNumbers: typeof o.lineNumbers === 'boolean' ? o.lineNumbers : DEFAULT_SETTINGS.lineNumbers,
    autoSave,
  }
}

export function loadSettings(): NoteSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) return coerceSettings(JSON.parse(stored))
    // First run after consolidation: adopt the standalone theme key if present.
    const legacy = localStorage.getItem(LEGACY_THEME_KEY)
    return legacy ? { ...DEFAULT_SETTINGS, theme: legacy } : DEFAULT_SETTINGS
  } catch {
    // Blocked storage, private mode, or corrupt JSON — defaults, never a crash.
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: NoteSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    localStorage.removeItem(LEGACY_THEME_KEY)
  } catch {
    /* non-fatal */
  }
}

export function fontStack(id: FontFamilyId): string {
  return FONT_FAMILIES.find((f) => f.id === id)?.stack ?? FONT_FAMILIES[0].stack
}

/** Inline style for the rendered markdown surface. */
export function readerStyle(s: NoteSettings): Record<string, string> {
  const style: Record<string, string> = {
    fontFamily: fontStack(s.fontFamily),
    fontSize: `${s.fontSize}px`,
  }
  // 0 means unconstrained; emitting maxWidth: "0px" would collapse the pane.
  if (s.maxWidth > 0) style.maxWidth = `${s.maxWidth}px`
  return style
}

/*
A subscription, because settings are read in one place and written in another.

Without this, each useNoteSettings() call owned an isolated useState: the
settings panel wrote to localStorage and the note surface never heard about it,
so picking a theme or a font size changed nothing on screen until a reload.
That was reported as "it's not even reflected in the UI".

Deliberately a module-level store rather than React context: the note surface
and the settings panel are not guaranteed to share a provider (the desktop app
mounts them in completely separate trees), and a context they both had to be
wrapped in would be one more thing to forget.
*/

type Listener = (s: NoteSettings) => void
const listeners = new Set<Listener>()
let current: NoteSettings | null = null

/** The live settings, loaded once and then kept in memory. */
export function getSettings(): NoteSettings {
  if (!current) current = loadSettings()
  return current
}

export function setSettings(next: NoteSettings): void {
  current = next
  saveSettings(next)
  for (const fn of listeners) fn(next)
}

export function subscribeSettings(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * Another tab changed them. Storage events do not fire in the tab that wrote,
 * so this only ever brings in someone else's change.
 */
export function watchExternalSettings(): () => void {
  if (typeof window === "undefined") return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    current = loadSettings()
    for (const fn of listeners) fn(current)
  }
  window.addEventListener("storage", onStorage)
  return () => window.removeEventListener("storage", onStorage)
}
