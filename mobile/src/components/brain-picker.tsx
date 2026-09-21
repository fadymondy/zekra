import { ScrollView, Pressable, StyleSheet, Text, Platform } from "react-native";
import * as Haptics from "expo-haptics";

import { useBrains } from "@/providers/brains";
import { usePalette } from "@/theme";

export function BrainPicker() {
  const p = usePalette();
  const { brains, namespace, select } = useBrains();
  if (brains.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={{ marginHorizontal: 16, borderColor: p.line, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth }}>
      {brains.map((brain) => {
        const active = brain.namespace === namespace;
        return (
          <Pressable
            key={brain.namespace}
            onPress={() => { void Haptics.selectionAsync(); void select(brain.namespace); }}
            style={[styles.pill, { backgroundColor: active ? p.action : p.card, borderColor: active ? p.action : p.line }]}
          >
            <Text numberOfLines={1} style={[styles.text, { color: active ? p.onAction : p.body }]}>
              {brain.displayName || brain.namespace}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 7 },
  pill: { borderWidth: 1, borderRadius: 0, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 190 },
  text: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
});
