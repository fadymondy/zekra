"use client"

import { CheckIcon, RotateCcwIcon } from "lucide-react"

import { noteIcon } from "@/lib/notes/note-icon"
import { CATEGORY_ICONS, FALLBACK_ICON } from "@/lib/notes/note-icon-map"

/*
Pick a note's icon and colour (MH-308).

The options are the SAME curated sets the server validates against
(plugins/brain/internal/brain/note_appearance.go). Offering anything else would
produce a picker whose choices the API rejects — there is a Go test asserting
every advertised name is accepted, and this is the other half of that contract.

Colours are a fixed set rather than a free picker because the reading themes
repaint the whole app: a colour that reads well in GitHub Dark can be invisible
in Solarized Light. "Reset" clears both and returns the note to the appearance
derived from its category, which is the default every note starts with.
*/

/** Icon names, de-duplicated — several categories share one icon. */
const ICON_NAMES = Array.from(new Set([FALLBACK_ICON, ...Object.values(CATEGORY_ICONS).map((s) => s.icon)]))

/** Colours, de-duplicated and excluding the CSS variable used for "note". */
const COLORS = Array.from(
  new Set(Object.values(CATEGORY_ICONS).map((s) => s.color).filter((c) => c.startsWith("#"))),
)

export interface AppearancePatch {
  icon?: string
  color?: string
}

export function NoteAppearancePicker({
  icon,
  color,
  category,
  onChange,
}: {
  icon?: string
  color?: string
  category?: string | null
  onChange: (patch: AppearancePatch) => void
}) {
  // Preview against the current override so the swatches show what the note
  // will actually look like, not the raw palette.
  const current = noteIcon({ icon, color, category })

  return (
    <div className="w-60 space-y-3 p-2">
      <div>
        <p className="mb-1.5 font-mono text-[10px] tracking-wider text-grid-muted uppercase">Icon</p>
        <div className="grid grid-cols-8 gap-1">
          {ICON_NAMES.map((name) => {
            const { Icon } = noteIcon({ icon: name, category })
            const active = icon === name
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={active}
                onClick={() => onChange({ icon: name })}
                className={`flex size-6 items-center justify-center rounded-sm transition ${
                  active ? "bg-grid-action text-grid-on-action" : "text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
                }`}
              >
                <Icon className="size-3.5" />
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10px] tracking-wider text-grid-muted uppercase">Colour</p>
        <div className="grid grid-cols-8 gap-1">
          {COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              aria-pressed={color === hex}
              onClick={() => onChange({ color: hex })}
              className="flex size-6 items-center justify-center rounded-sm"
              style={{ background: hex }}
            >
              {color === hex ? <CheckIcon className="size-3 text-white" /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2">
        <span className="flex items-center gap-1.5 text-xs text-grid-muted">
          <current.Icon className="size-3.5" style={{ color: current.color }} />
          {icon || color ? "Custom" : "From category"}
        </span>
        <button
          type="button"
          // Empty strings, not undefined: the server reads "" as "clear the
          // override", while omitting the field would leave it unchanged.
          onClick={() => onChange({ icon: "", color: "" })}
          disabled={!icon && !color}
          className="flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg disabled:opacity-40"
        >
          <RotateCcwIcon className="size-3" />
          Reset
        </button>
      </div>
    </div>
  )
}
