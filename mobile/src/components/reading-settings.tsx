import { Check, Minus, Plus } from "lucide-react-native";
import { Platform, Pressable, StyleSheet, Switch, View } from "react-native";

import { FilterStrip } from "@/components/kit";
import { AppText, Row } from "@/components/ui";
import type { FontFamilyId } from "@/features/editor/bridge-core";
import { useI18n } from "@/lib/i18n";
import {
  FONT_FAMILY_IDS,
  FONT_SIZE_RANGE,
  MAX_WIDTH_OPTIONS,
  READING_THEMES,
  updateReading,
  useReadingSettings,
} from "@/lib/reading-settings";
import { fonts, metrics, usePalette } from "@/theme";
import type { ThemeDefinition } from "@shared/markdown/themes/themes";

/*
Reading settings (MH-266, MH-366): the theme picker and typography, the same
choices as web's note settings panel. Every control writes the shared store
(src/lib/reading-settings.ts), so the change is visible at once — the app
repaints from the theme (theme.ts) and an open note re-styles (note engine).

Two exports:
  ReadingSettings       the bare controls, for a sheet (the note screen's ⋯)
  ReadingSettingsPanel  the same inside a Row, for the settings screen

Stepper, not a slider, for size: a slider is a native dependency and fiddly
across a 12–24 range; ± gives exact values.
*/

const LIGHT = READING_THEMES.filter((t) => t.kind === "light");
const DARK = READING_THEMES.filter((t) => t.kind === "dark");

/** Native approximations of the page's font stacks, for the live sample. */
const SAMPLE_FAMILY: Record<FontFamilyId, string | undefined> = {
  system: fonts.regular,
  serif: Platform.select({ ios: "Georgia", default: "serif" }),
  sans: Platform.select({ ios: "Helvetica Neue", default: "sans-serif" }),
  mono: fonts.mono,
  reading: Platform.select({ ios: "Iowan Old Style", default: "serif" }),
};

export function ReadingSettings() {
  const p = usePalette();
  const { t } = useI18n();
  const reading = useReadingSettings();

  const step = (by: number) =>
    updateReading({ fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, reading.fontSize + by)) });

  const swatch = (theme: ThemeDefinition | null) => {
    const active = (theme?.id ?? null) === reading.theme;
    const bg = theme ? theme.palette.bg : p.bg;
    const fg = theme ? theme.palette.fg : p.ink;
    const accent = theme ? theme.palette.accent : p.action;
    const muted = theme ? theme.palette.fgMuted : p.muted;
    const border = theme ? theme.palette.border : p.line;
    const label = theme ? theme.label : t("reading.ownPalette");
    return (
      <Pressable
        key={theme?.id ?? "zekra"}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={() => updateReading({ theme: theme?.id ?? null })}
        style={[styles.swatch, { backgroundColor: bg, borderColor: active ? p.action : border, borderWidth: active ? 2 : 1 }]}
      >
        <View style={[styles.bar, { backgroundColor: fg, width: "70%" }]} />
        <View style={[styles.bar, { backgroundColor: accent, width: "45%" }]} />
        <View style={[styles.bar, { backgroundColor: muted, width: "60%" }]} />
        <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12, color: muted, marginTop: 4, writingDirection: "ltr" }}>
          {label}
        </AppText>
        {active ? (
          <View style={[styles.tick, { backgroundColor: p.action }]}>
            <Check color={p.onAction} size={10} strokeWidth={3} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <AppText variant="micro">{t("editor.reading.theme").toUpperCase()}</AppText>
        <View style={styles.grid}>{swatch(null)}</View>
        <AppText variant="micro" style={{ marginTop: 4 }}>{t("editor.reading.light").toUpperCase()}</AppText>
        <View style={styles.grid}>{LIGHT.map(swatch)}</View>
        <AppText variant="micro" style={{ marginTop: 4 }}>{t("editor.reading.dark").toUpperCase()}</AppText>
        <View style={styles.grid}>{DARK.map(swatch)}</View>
      </View>

      <View style={{ gap: 4 }}>
        <AppText variant="micro">{t("editor.reading.font").toUpperCase()}</AppText>
        <FilterStrip
          inset={false}
          value={reading.fontFamily}
          onChange={(fontFamily) => updateReading({ fontFamily })}
          options={FONT_FAMILY_IDS.map((id) => ({ value: id, label: t(`editor.font.${id}`) }))}
        />
      </View>

      <View style={{ gap: 10 }}>
        <View style={styles.sizeRow}>
          <AppText variant="body" style={{ flex: 1 }}>{t("reading.fontSize")}</AppText>
          <Pressable
            onPress={() => step(-1)}
            disabled={reading.fontSize <= FONT_SIZE_RANGE.min}
            accessibilityRole="button"
            accessibilityLabel={t("reading.smaller")}
            style={[styles.step, { borderColor: p.line, opacity: reading.fontSize <= FONT_SIZE_RANGE.min ? 0.4 : 1 }]}
          >
            <Minus color={p.body} size={16} />
          </Pressable>
          <AppText variant="mono" style={{ width: 46, textAlign: "center", writingDirection: "ltr" }}>{reading.fontSize}px</AppText>
          <Pressable
            onPress={() => step(1)}
            disabled={reading.fontSize >= FONT_SIZE_RANGE.max}
            accessibilityRole="button"
            accessibilityLabel={t("reading.larger")}
            style={[styles.step, { borderColor: p.line, opacity: reading.fontSize >= FONT_SIZE_RANGE.max ? 0.4 : 1 }]}
          >
            <Plus color={p.body} size={16} />
          </Pressable>
        </View>
        <View style={[styles.sample, { borderColor: p.line, backgroundColor: p.card }]}>
          <AppText style={{ fontFamily: SAMPLE_FAMILY[reading.fontFamily], fontSize: reading.fontSize, lineHeight: Math.round(reading.fontSize * 1.55), color: p.ink }}>
            {t("editor.reading.sample")}
          </AppText>
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <AppText variant="micro">{t("editor.reading.width").toUpperCase()}</AppText>
        <FilterStrip
          inset={false}
          value={String(MAX_WIDTH_OPTIONS.includes(reading.maxWidth as (typeof MAX_WIDTH_OPTIONS)[number]) ? reading.maxWidth : 0)}
          onChange={(v) => updateReading({ maxWidth: Number(v) })}
          options={MAX_WIDTH_OPTIONS.map((w) => ({ value: String(w), label: w === 0 ? t("editor.reading.full") : `${w}px` }))}
        />
      </View>

      <View style={styles.toggle}>
        <AppText variant="body" style={{ flex: 1 }}>{t("editor.reading.wrap")}</AppText>
        <Switch value={reading.wordWrap} onValueChange={(wordWrap) => updateReading({ wordWrap })} trackColor={{ true: p.action }} />
      </View>
      <View style={styles.toggle}>
        <AppText variant="body" style={{ flex: 1 }}>{t("editor.reading.lines")}</AppText>
        <Switch value={reading.lineNumbers} onValueChange={(lineNumbers) => updateReading({ lineNumbers })} trackColor={{ true: p.action }} />
      </View>
    </View>
  );
}

/** The settings screen's section: the same controls in a Row. */
export function ReadingSettingsPanel() {
  const { t } = useI18n();
  return (
    <Row style={{ gap: 14 }}>
      <AppText variant="micro">{t("reading.title").toUpperCase()}</AppText>
      <ReadingSettings />
    </Row>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 92, minHeight: 64, padding: 8, borderRadius: metrics.radius.chip, gap: 4 },
  bar: { height: 4, borderRadius: 2 },
  tick: { position: "absolute", top: 5, end: 5, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sizeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  step: { width: 36, height: 36, borderWidth: 1, borderRadius: metrics.radius.chip, alignItems: "center", justifyContent: "center" },
  sample: { borderWidth: 1, borderRadius: metrics.radius.control, paddingHorizontal: 14, paddingVertical: 12 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
});
