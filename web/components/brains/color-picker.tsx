"use client"

// Brain colour picker: the palette as swatches plus a custom hex (text + native colour input).
// The value is a palette key ("teal") or "#rrggbb"; "" means the brain's default colour.
import { useEffect, useState } from "react"
import { CheckIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { HEX_RE, PALETTE, resolveColor, type PaletteColor } from "@/lib/brain-profile"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function ColorPicker({
  value,
  onChange,
  palette = PALETTE,
  disabled,
  idPrefix = "brain-color",
  custom = true,
}: {
  value: string
  onChange: (v: string) => void
  palette?: PaletteColor[]
  disabled?: boolean
  idPrefix?: string
  custom?: boolean
}) {
  const { t } = useTranslations()
  const isCustom = !!value && !palette.some((p) => p.key === value)
  const [hex, setHex] = useState(isCustom ? value : "")
  useEffect(() => {
    if (isCustom) setHex(value)
  }, [isCustom, value])

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label={t("brainSettings.color.palette")} className="flex flex-wrap gap-2">
        {palette.map((p) => {
          const on = value === p.key
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(`brainSettings.color.${p.key}`)}
              title={t(`brainSettings.color.${p.key}`)}
              disabled={disabled}
              onClick={() => onChange(p.key)}
              className={cn(
                "flex size-7 items-center justify-center border border-line outline-offset-2 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
                on && "ring-2 ring-grid-fg ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: p.hex }}
            >
              {on ? <CheckIcon className="size-3.5 text-white drop-shadow" /> : null}
            </button>
          )
        })}
      </div>
      {custom ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={t("brainSettings.color.customPick")}
            disabled={disabled}
            value={resolveColor(value) || "#64748b"}
            onChange={(e) => {
              setHex(e.target.value)
              onChange(e.target.value.toLowerCase())
            }}
            className="h-8 w-10 cursor-pointer border border-line bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Input
            id={`${idPrefix}-hex`}
            dir="ltr"
            disabled={disabled}
            value={hex}
            placeholder="#14b8a6"
            maxLength={7}
            aria-label={t("brainSettings.color.custom")}
            aria-invalid={!!hex && !HEX_RE.test(hex)}
            onChange={(e) => {
              const v = e.target.value.trim()
              setHex(v)
              if (HEX_RE.test(v)) onChange(v.toLowerCase())
            }}
            className="w-32 font-mono"
          />
          {value ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setHex("")
                onChange("")
              }}
              className="text-xs text-grid-muted underline underline-offset-4 hover:text-grid-fg"
            >
              {t("brainSettings.color.reset")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
