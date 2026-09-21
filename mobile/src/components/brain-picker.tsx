import * as Haptics from "expo-haptics";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, usePalette } from "@/theme";

// A horizontal filter row of brains. The ScrollView MUST be flexGrow:0 with a
// fixed height: as a plain flex child it stretched to fill the whole screen,
// which pushed the search field to the bottom and left the note list with no
// room at all.
const ROW_HEIGHT = 38;

export function BrainPicker() {
  const p = usePalette();
  const { brains, namespace, select } = useBrains();
  if (brains.length < 2) return null;
  return (
    <View style={[styles.wrap, { borderBottomColor: p.line }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.scroll}
      >
        {brains.map((brain) => {
          const active = brain.namespace === namespace;
          return (
            <Pressable
              key={brain.namespace}
              onPress={() => {
                if (Platform.OS !== "web") void Haptics.selectionAsync();
                void select(brain.namespace);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  borderColor: active ? p.gold : p.line,
                  backgroundColor: active ? `${p.gold}1A` : p.card,
                },
              ]}
            >
              <AppText
                numberOfLines={1}
                color={active ? p.gold : p.body}
                style={{ fontFamily: active ? fonts.medium : fonts.regular, fontSize: 13 }}
              >
                {brain.displayName || brain.namespace}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: ROW_HEIGHT + 16, flexGrow: 0, flexShrink: 0, borderBottomWidth: 1, justifyContent: "center" },
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: metrics.padX, gap: 8, alignItems: "center" },
  chip: {
    height: ROW_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: metrics.radius.chip,
    maxWidth: 200,
  },
});
