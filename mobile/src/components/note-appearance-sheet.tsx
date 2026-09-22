import { Check, RotateCcw } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { noteIcon } from "@/lib/note-icon";
import { CATEGORY_ICONS, FALLBACK_ICON } from "@shared/notes/note-icon-map";
import { metrics, usePalette } from "@/theme";

/*
Pick a note's icon and colour on mobile (MH-308).

The options come from the SAME shared map the web picker and the Go validator
read (plugins/brain/internal/brain/note_appearance.go), so a choice made here is
one the API accepts and one that renders identically on web and desktop. React
Native has no context menu, so this is a modal sheet reached from the row's
long-press menu — the mobile equivalent of the web's ContextMenuSub.
*/

/** Icon names, de-duplicated — several categories share one icon. */
const ICON_NAMES = Array.from(new Set([FALLBACK_ICON, ...Object.values(CATEGORY_ICONS).map((s) => s.icon)]));

/** Colours, de-duplicated and excluding the CSS variable used for "note". */
const COLORS = Array.from(new Set(Object.values(CATEGORY_ICONS).map((s) => s.color).filter((c) => c.startsWith("#"))));

export interface AppearancePatch {
  icon?: string;
  color?: string;
}

export function NoteAppearanceSheet({
  visible,
  icon,
  color,
  category,
  onChange,
  onClose,
}: {
  visible: boolean;
  icon?: string;
  color?: string;
  category?: string | null;
  onChange: (patch: AppearancePatch) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const current = noteIcon({ icon, color, category }, p.muted);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: p.bg, borderTopColor: p.line }]}>
        <View style={styles.head}>
          <current.Icon color={current.color} size={18} strokeWidth={1.8} />
          <AppText variant="rowTitle" style={{ flex: 1 }}>{t("row.appearance")}</AppText>
          <Pressable
            // Empty strings, not undefined: the server reads "" as "clear the
            // override", while omitting the field would leave it unchanged.
            onPress={() => onChange({ icon: "", color: "" })}
            disabled={!icon && !color}
            style={[styles.reset, { opacity: icon || color ? 1 : 0.4 }]}
          >
            <RotateCcw color={p.muted} size={14} />
            <AppText variant="micro">{t("row.appearanceReset")}</AppText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <AppText variant="micro">{t("row.appearanceIcon").toUpperCase()}</AppText>
          <View style={styles.grid}>
            {ICON_NAMES.map((name) => {
              const { Icon } = noteIcon({ icon: name, category }, p.muted);
              const active = icon === name;
              return (
                <Pressable
                  key={name}
                  accessibilityLabel={name}
                  onPress={() => onChange({ icon: name })}
                  style={[styles.cell, { backgroundColor: active ? p.action : p.soft }]}
                >
                  <Icon color={active ? p.bg : p.body} size={17} strokeWidth={1.8} />
                </Pressable>
              );
            })}
          </View>

          <AppText variant="micro">{t("row.appearanceColor").toUpperCase()}</AppText>
          <View style={styles.grid}>
            {COLORS.map((hex) => (
              <Pressable
                key={hex}
                accessibilityLabel={hex}
                onPress={() => onChange({ color: hex })}
                style={[styles.cell, { backgroundColor: hex }]}
              >
                {color === hex ? <Check color="#fff" size={15} /> : null}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopWidth: 1, paddingHorizontal: metrics.padX, paddingTop: 14, paddingBottom: 28, maxHeight: "62%" },
  head: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 },
  reset: { flexDirection: "row", alignItems: "center", gap: 5 },
  body: { gap: 9, paddingBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  cell: { width: 38, height: 38, borderRadius: metrics.radius.chip, alignItems: "center", justifyContent: "center" },
});
