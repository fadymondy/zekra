import type { CSSProperties } from "react";
import { Check, RotateCcw } from "lucide-react";

import type { AppearancePatch } from "@/components/notes/note-appearance-picker";
import { noteIcon } from "@/lib/notes/note-icon";
import { CATEGORY_ICONS, FALLBACK_ICON, type NoteAppearance } from "@/lib/notes/note-icon-map";
import { cn } from "@/lib/utils";

import { useI18n } from "../../lib/i18n";

/*
A note's icon + colour (MH-308) on the desktop: the tinted tile the list rows
and the editor header show, and the compact picker behind it.

The options are the web picker's (web/components/notes/note-appearance-picker
.tsx) — the curated sets the server validates against (note_appearance.go):
15 icons, 13 colours. Not that component itself: its labels are hard-coded
English, and the desktop is bilingual. "" clears an override (back to the
category's look); an omitted field is left unchanged.
*/

export const NOTE_ICON_NAMES: string[] = Array.from(
  new Set([FALLBACK_ICON, ...Object.values(CATEGORY_ICONS).map((s) => s.icon)]),
);
export const NOTE_COLORS: string[] = Array.from(
  new Set(Object.values(CATEGORY_ICONS).map((s) => s.color).filter((c) => c.startsWith("#"))),
);

/** The tile's wash: the icon colour, faint, on any theme. */
export const tileStyle = (color: string): CSSProperties => ({
  color,
  background: `color-mix(in oklab, ${color} 15%, transparent)`,
});

export function NoteIconTile({ note, className, iconClassName }: {
  note: NoteAppearance;
  className?: string;
  iconClassName?: string;
}) {
  const { Icon, color } = noteIcon(note);
  return (
    <span aria-hidden data-slot="note-tile" className={cn("flex shrink-0 items-center justify-center", className)} style={tileStyle(color)}>
      <Icon className={cn("stroke-[1.75]", iconClassName)} />
    </span>
  );
}

export function AppearancePicker({ icon, color, category, onChange }: {
  icon?: string;
  color?: string;
  category?: string | null;
  onChange: (patch: AppearancePatch) => void;
}) {
  const { t } = useI18n();
  const current = noteIcon({ icon, color, category });
  const custom = Boolean(icon || color);
  return (
    <div className="flex w-[244px] flex-col gap-3">
      <section>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("ws.icon.icon")}</p>
        <div className="grid grid-cols-8 gap-1">
          {NOTE_ICON_NAMES.map((name) => {
            const { Icon } = noteIcon({ icon: name, category });
            const active = icon === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={active}
                title={name}
                onClick={() => onChange({ icon: name })}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors",
                  active ? "text-foreground ring-2 ring-ring" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
                style={active ? tileStyle(current.color) : undefined}
              >
                <Icon className="size-4 stroke-[1.75]" />
              </button>
            );
          })}
        </div>
      </section>
      <section>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("ws.icon.color")}</p>
        <div className="grid grid-cols-8 gap-1">
          {NOTE_COLORS.map((hex) => {
            const active = color === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                aria-pressed={active}
                onClick={() => onChange({ color: hex })}
                className={cn("flex size-7 items-center justify-center rounded-full", active && "ring-2 ring-ring ring-offset-2 ring-offset-popover")}
                style={{ background: hex }}
              >
                {active ? <Check className="size-3.5 text-white" /> : null}
              </button>
            );
          })}
        </div>
      </section>
      <div className="flex items-center justify-between border-t border-border/60 pt-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <current.Icon className="size-3.5" style={{ color: current.color }} />
          {custom ? t("ws.icon.custom") : t("ws.icon.derived")}
        </span>
        <button
          type="button"
          // Empty strings, not undefined: "" clears the override server-side.
          onClick={() => onChange({ icon: "", color: "" })}
          disabled={!custom}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="size-3" />
          {t("ws.icon.reset")}
        </button>
      </div>
    </div>
  );
}
