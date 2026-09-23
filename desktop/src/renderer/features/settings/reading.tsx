import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useNoteSettings } from "@/components/notes/note-settings-panel";
import { groupedThemes } from "@/lib/markdown/themes/apply";
import type { ThemeDefinition } from "@/lib/markdown/themes/themes";
import { FONT_FAMILIES, FONT_SIZE_RANGE, MAX_WIDTH_RANGE, type AutoSave, type FontFamilyId } from "@/lib/notes/note-settings";
import { cn } from "@/lib/utils";

import { useI18n, type TKey } from "../../lib/i18n";
import { Group, Row, Segmented, SettingsHeader } from "./ui";

/*
Settings ▸ Reading — the reading theme, typography and editor preferences,
built from the desktop's grouped rows (ui.tsx) instead of the web console's
NoteSettingsPanel. Same store and behaviour: the web's note-settings
(localStorage "zekra.note-settings", useNoteSettings), which lib/appearance.ts
applies live in every window.

  Reading theme   a grid of swatch cards; "Zekra" (the app's own palette,
                  following light / dark) is the first card
  Typography      font · body size · reading width
  Editor          word wrap · line numbers in code blocks · auto-save
*/

const FONT_LABEL: Record<FontFamilyId, TKey> = {
  system: "win.font.system",
  serif: "win.font.serif",
  sans: "win.font.sans",
  mono: "win.font.mono",
  reading: "win.font.reading",
};

export function ReadingSettings() {
  const { t } = useI18n();
  const { settings, update } = useNoteSettings();
  const { light, dark } = groupedThemes();

  return (
    <>
      <SettingsHeader title={t("settings.section.reading")} description={t("settings.x.readingBody")} />

      <Group title={t("reading.theme")} description={t("reading.themeHint")}>
        <div className="@container">
        <div role="radiogroup" aria-label={t("reading.theme")} className="grid grid-cols-2 gap-2.5 p-3 @sm:grid-cols-3 @3xl:grid-cols-4">
          <ZekraCard selected={!settings.theme} onSelect={() => update({ theme: null })} />
          {[...light, ...dark].map((theme) => (
            <ThemeCard key={theme.id} theme={theme} selected={settings.theme === theme.id} onSelect={() => update({ theme: theme.id })} />
          ))}
        </div>
        </div>
      </Group>

      <Group title={t("reading.typography")} description={t("reading.typographyHint")}>
        <Row label={t("reading.fontFamily")} hint={t("reading.fontFamilyHint")}>
          <Select value={settings.fontFamily} onValueChange={(v) => v && update({ fontFamily: v as FontFamilyId })}>
            <SelectTrigger className="h-7 w-40 text-[13px]" aria-label={t("reading.fontFamily")}>
              <SelectValue>{(id: FontFamilyId) => t(FONT_LABEL[id] ?? "win.font.system")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  <span style={{ fontFamily: f.stack }}>{t(FONT_LABEL[f.id])}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("reading.fontSize")} hint={t("reading.fontSizeHint")}>
          <Range
            label={t("reading.fontSize")}
            min={FONT_SIZE_RANGE.min}
            max={FONT_SIZE_RANGE.max}
            value={settings.fontSize}
            onChange={(n) => update({ fontSize: n })}
            format={(n) => `${n}px`}
          />
        </Row>
        <Row label={t("reading.maxWidth")} hint={t("reading.maxWidthHint")}>
          <Range
            label={t("reading.maxWidth")}
            min={MAX_WIDTH_RANGE.min}
            max={MAX_WIDTH_RANGE.max}
            step={MAX_WIDTH_RANGE.step}
            value={settings.maxWidth}
            onChange={(n) => update({ maxWidth: n })}
            format={(n) => (n === 0 ? t("reading.fullWidth") : `${n}px`)}
          />
        </Row>
      </Group>

      <Group title={t("reading.editor")} description={t("reading.editorHint")}>
        <Row label={t("reading.wordWrap")} hint={t("reading.wordWrapHint")}>
          <Switch checked={settings.wordWrap} onCheckedChange={(v) => update({ wordWrap: v })} aria-label={t("reading.wordWrap")} />
        </Row>
        <Row label={t("reading.lineNumbers")} hint={t("reading.lineNumbersHint")}>
          <Switch checked={settings.lineNumbers} onCheckedChange={(v) => update({ lineNumbers: v })} aria-label={t("reading.lineNumbers")} />
        </Row>
        <Row label={t("reading.autoSave")} hint={t("reading.autoSaveHint")}>
          <Segmented<AutoSave>
            label={t("reading.autoSave")}
            value={settings.autoSave}
            onChange={(v) => update({ autoSave: v })}
            options={[
              { value: "off", label: t("reading.autoSaveOff") },
              { value: "blur", label: t("reading.autoSaveBlur") },
              { value: "interval", label: t("reading.autoSaveInterval") },
            ]}
          />
        </Row>
      </Group>
    </>
  );
}

/** A compact slider with its value; pinned LTR (a magnitude grows rightward
 *  in Arabic too — the web panel's rule). */
function Range({ label, min, max, step = 1, value, onChange, format }: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
}) {
  return (
    <span className="flex items-center gap-3">
      <input
        type="range"
        dir="ltr"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="zk-range w-40"
      />
      <span className="w-16 text-end text-[13px] text-muted-foreground tabular-nums">{format(value)}</span>
    </span>
  );
}

/** The card frame every theme swatch shares. */
function Card({ selected, onSelect, label, badge, title, children }: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  badge?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={title}
      onClick={onSelect}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-lg border text-start outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60",
        selected ? "border-primary ring-2 ring-primary/35" : "border-border/80 hover:border-muted-foreground/50",
      )}
    >
      <span className="relative block h-14 w-full overflow-hidden">{children}</span>
      <span className="flex items-center gap-2 border-t border-border/60 bg-pane-raised px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" dir="auto">
          {label}
        </span>
        {selected ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={3} />
          </span>
        ) : badge ? (
          <span className="shrink-0 text-[12px] text-muted-foreground">{badge}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Heading, accent, body and a muted line, in a palette's own colours. */
function Bars({ bg, fg, accent, muted }: { bg: string; fg: string; accent: string; muted: string }) {
  return (
    <span className="flex h-full flex-col justify-center gap-1.5 px-3" style={{ background: bg }}>
      <span className="block h-1.5 w-3/4 rounded-sm" style={{ background: fg, opacity: 0.85 }} />
      <span className="block h-1.5 w-1/3 rounded-sm" style={{ background: accent }} />
      <span className="block h-1.5 w-full rounded-sm" style={{ background: muted, opacity: 0.45 }} />
      <span className="block h-1.5 w-1/2 rounded-sm" style={{ background: muted, opacity: 0.3 }} />
    </span>
  );
}

function ThemeCard({ theme, selected, onSelect }: { theme: ThemeDefinition; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const p = theme.palette;
  return (
    <Card selected={selected} onSelect={onSelect} label={theme.label} title={`${theme.label} · ${t(theme.kind === "dark" ? "win.theme.dark" : "win.theme.light")}`}>
      <Bars bg={p.bg} fg={p.fg} accent={p.link} muted={p.fgMuted} />
    </Card>
  );
}

/** Zekra's own palette (grid tokens, data-brand="cabrain"): ivory / navy, the
 *  violet action and the gold accent — light and dark halves, since it
 *  follows Settings ▸ General ▸ Appearance. */
function ZekraCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  return (
    <Card selected={selected} onSelect={onSelect} label={t("win.theme.zekra")} badge={t("win.theme.auto")}>
      <span className="grid h-full grid-cols-2" dir="ltr">
        <Bars bg="#f0ebe1" fg="#0e1a3c" accent="#6d4de6" muted="#6e6551" />
        <Bars bg="#0b1429" fg="#f0ebe1" accent="#c9a227" muted="#8a97b8" />
      </span>
    </Card>
  );
}
