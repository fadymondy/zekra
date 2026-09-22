import { Check, Minus, Plus, RotateCcw } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText, Row } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { READING_THEMES, useReading } from "@/lib/reading-settings";
import { FONT_SIZE_RANGE } from "@shared/notes/note-settings";
import { metrics, usePalette } from "@/theme";

/*
The mobile half of the reading settings (MH-266): body size and the reading
theme, sharing the 27 palettes with web.

Stepper, not a slider. A slider needs @react-native-community/slider (a native
module, so a new dependency and a rebuild) and is fiddly at a 12–24 range on a
touch target; +/- gives exact values and one obvious affordance.

Each theme card previews its OWN palette, as the web picker does — the point of
picking a reading theme is how it looks, which a label cannot convey.
*/
export function ReadingSettingsPanel() {
  const p = usePalette();
  const { t } = useI18n();
  const { reading, setReading } = useReading();

  const step = (by: number) =>
    setReading({
      ...reading,
      fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, reading.fontSize + by)),
    });

  return (
    <Row style={{ gap: 14 }}>
      <AppText variant="micro">{t("reading.title").toUpperCase()}</AppText>

      <View style={styles.sizeRow}>
        <AppText variant="body" style={{ flex: 1 }}>{t("reading.fontSize")}</AppText>
        <Pressable
          onPress={() => step(-1)}
          disabled={reading.fontSize <= FONT_SIZE_RANGE.min}
          accessibilityLabel={t("reading.smaller")}
          style={[styles.step, { borderColor: p.line, opacity: reading.fontSize <= FONT_SIZE_RANGE.min ? 0.4 : 1 }]}
        >
          <Minus color={p.body} size={16} />
        </Pressable>
        {/* Tabular width so the row does not shift as the number changes. */}
        <AppText variant="mono" style={{ width: 44, textAlign: "center" }}>{reading.fontSize}px</AppText>
        <Pressable
          onPress={() => step(1)}
          disabled={reading.fontSize >= FONT_SIZE_RANGE.max}
          accessibilityLabel={t("reading.larger")}
          style={[styles.step, { borderColor: p.line, opacity: reading.fontSize >= FONT_SIZE_RANGE.max ? 0.4 : 1 }]}
        >
          <Plus color={p.body} size={16} />
        </Pressable>
      </View>

      <View style={styles.themeHead}>
        <AppText variant="micro" style={{ flex: 1 }}>{t("reading.theme").toUpperCase()}</AppText>
        <Pressable
          onPress={() => setReading({ ...reading, theme: null })}
          disabled={!reading.theme}
          style={[styles.reset, { opacity: reading.theme ? 1 : 0.4 }]}
        >
          <RotateCcw color={p.muted} size={13} />
          <AppText variant="micro">{t("reading.ownPalette")}</AppText>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themes}>
        {READING_THEMES.map((theme) => {
          const active = reading.theme === theme.id;
          return (
            <Pressable
              key={theme.id}
              accessibilityLabel={theme.label}
              onPress={() => setReading({ ...reading, theme: theme.id })}
              style={[
                styles.card,
                { backgroundColor: theme.palette.bg, borderColor: active ? p.action : theme.palette.border },
              ]}
            >
              {/* Stand-ins for a heading, an accented line and body text. */}
              <View style={[styles.bar, { backgroundColor: theme.palette.fg, width: 34 }]} />
              <View style={[styles.bar, { backgroundColor: theme.palette.accent, width: 24 }]} />
              <View style={[styles.bar, { backgroundColor: theme.palette.fgMuted, width: 30 }]} />
              <AppText variant="micro" color={theme.palette.fgMuted} numberOfLines={1} style={{ marginTop: 3 }}>
                {theme.label}
              </AppText>
              {active ? <Check color={p.action} size={13} style={styles.tick} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Row>
  );
}

const styles = StyleSheet.create({
  sizeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  step: { width: 34, height: 34, borderWidth: 1, borderRadius: metrics.radius.chip, alignItems: "center", justifyContent: "center" },
  themeHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  reset: { flexDirection: "row", alignItems: "center", gap: 5 },
  themes: { gap: 8, paddingVertical: 2 },
  card: { width: 96, padding: 8, borderWidth: 1, borderRadius: metrics.radius.chip, gap: 3 },
  bar: { height: 4, borderRadius: 2 },
  tick: { position: "absolute", top: 5, right: 5 },
});
