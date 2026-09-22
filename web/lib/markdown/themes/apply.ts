import { hljsTokensFor } from './hljsCss.ts'
import type { ThemeDefinition } from './themes.ts'
import { THEMES } from './themes.ts'

/*
Turn a ported mark-it-down theme into CSS custom properties.

SCOPE DECISION — read before changing this.

mark-it-down hit a regression here twice. A refactor once made themes recolour
only the note pane while the app chrome stayed fixed, which made picking a
theme look dead (worst on the all-chrome settings page); the committed fix
repainted the WHOLE app from the palette. See the `mark-it-down` brain, memory
ba160c10.

Zekra cannot simply copy that fix. Repainting the whole console would override
the grid design system and the brand palette that `data-brand="cabrain"`
selects — the violet identity, the gold accent, the hatch ground. A Dracula
console is not Zekra.

So the scope here is the NOTE SURFACE: the reading pane's background, text,
borders, links, code blocks and tables. That is a large, obvious area, so
switching theme is plainly visible and does not feel dead — but the shell,
navigation and brand stay Zekra's own.

The variables below are the same ones the markdown CSS already consumes
(globals.css), so a theme is a variable swap and nothing else re-renders.
*/

export const NOTE_THEME_ATTR = 'data-note-theme'

/**
 * Apply a theme to the WHOLE app, or clear it.
 *
 * Written as inline custom properties on documentElement because that is the
 * only thing that reliably beats both the light and dark token scales, which
 * are themselves defined on :root and .dark. A stylesheet rule would lose to
 * `.dark` on specificity for every variable the dark scale also sets.
 *
 * This is the same shape as mark-it-down's own fix for the regression where
 * themes only repainted the reading pane (brain memory ba160c10).
 */
export function applyThemeToDocument(theme: ThemeDefinition | undefined): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // Clear previous inline values first: switching between two themes that set
  // different subsets would otherwise leave the earlier one's leftovers.
  for (const key of Object.keys(themeVars(THEMES[0]))) root.style.removeProperty(key)
  if (!theme) {
    root.removeAttribute(NOTE_THEME_ATTR)
    return
  }
  for (const [key, value] of Object.entries(themeVars(theme))) root.style.setProperty(key, value)
  root.setAttribute(NOTE_THEME_ATTR, theme.id)
}

/** Every variable a theme may set on the note surface. */
export function themeVars(theme: ThemeDefinition): Record<string, string> {
  const p = theme.palette
  const h = hljsTokensFor(theme)
  return {
    // Surface
    '--grid-bg': p.bg,
    '--grid-card': p.bg,
    '--grid-soft': p.inlineCodeBg,
    '--grid-fg': p.fg,
    '--grid-body': p.fg,
    '--grid-muted': p.fgMuted,
    '--grid-line': p.border,
    // Links keep the theme's own link colour rather than the brand violet:
    // inside a GitHub-Light note, a violet link looks wrong.
    '--grid-action': p.link,
    // Code
    '--hl-comment': h.comment,
    '--hl-keyword': h.keyword,
    '--hl-string': h.string,
    '--hl-number': h.number,
    '--hl-title': h.fn,
    '--hl-attr': h.attribute,
    '--hl-type': h.type,
    '--hl-meta': h.meta,
    // Code block background comes from the theme, not the app card colour.
    '--zk-code-bg': p.codeBg,
    '--zk-table-stripe': p.tableStripe,
  }
}

/** Serialise to a CSS declaration block for a <style> rule. */
export function themeCss(theme: ThemeDefinition, selector: string): string {
  const decls = Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}:${v};`)
    .join('')
  return `${selector}{${decls}}`
}

export function themeById(id: string | null | undefined): ThemeDefinition | undefined {
  if (!id) return undefined
  return THEMES.find((t) => t.id === id)
}

/** Light and dark groups, in catalogue order, for the picker. */
export function groupedThemes() {
  return {
    light: THEMES.filter((t) => t.kind === 'light'),
    dark: THEMES.filter((t) => t.kind === 'dark'),
  }
}
