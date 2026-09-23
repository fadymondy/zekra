import { Eye, Link2 } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { ForwardChevron } from "@/components/kit";
import { AppText, Cell } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

import { KindTile, LocaleChips, StatusChip, useFormat } from "./parts";
import { customerLine } from "./presentations-core";
import type { Summary } from "./types";

/** One presentation in a brain's list: kind tile, title, customer, then
 *  languages · status · live links · views (+ when last viewed). */
export function PresentationRow({ item, onPress, first = true, last = true }: { item: Summary; onPress: () => void; first?: boolean; last?: boolean }) {
  const p = usePalette();
  const { t } = useI18n();
  const f = useFormat();
  const who = customerLine(item.customer);
  const viewed = f.ago(item.last_viewed_at);
  return (
    <Cell first={first} last={last} dividerInset={metrics.padX + 38 + 13}>
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.cell, pressed && { backgroundColor: p.selected }]}>
      <View style={styles.top}>
        <KindTile kind={item.kind} />
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="rowTitle" numberOfLines={2}>{item.title || t("common.untitled")}</AppText>
          <AppText variant="meta" numberOfLines={1}>
            {[f.kind(item.kind), who].filter(Boolean).join(" · ")}
          </AppText>
        </View>
        <ForwardChevron />
      </View>
      <View style={styles.meta}>
        <LocaleChips locales={item.locales} />
        <StatusChip status={item.status} />
        <View style={styles.stat}>
          <Link2 size={13} color={item.active_shares ? p.action : p.muted} strokeWidth={1.8} />
          <AppText style={[styles.mono, { color: item.active_shares ? p.action : p.muted }]}>{item.active_shares}</AppText>
        </View>
        <View style={styles.stat}>
          <Eye size={13} color={p.muted} strokeWidth={1.8} />
          <AppText style={[styles.mono, { color: p.muted }]}>
            {viewed ? t("presentations.viewsAgo", { n: item.view_count, when: viewed }) : String(item.view_count)}
          </AppText>
        </View>
      </View>
      </Pressable>
    </Cell>
  );
}

const styles = StyleSheet.create({
  cell: { paddingHorizontal: metrics.padX, paddingVertical: 12, gap: 10 },
  top: { flexDirection: "row", alignItems: "center", gap: 13 },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4, marginStart: 2 },
  mono: { fontFamily: fonts.regular, fontSize: 13 },
});
