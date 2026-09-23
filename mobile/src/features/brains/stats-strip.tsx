import { StyleSheet, View } from "react-native";

import { AppText, Row } from "@/components/ui";
import { formatCount, type BrainStats } from "@/features/brains/brains-core";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

function Stat({ label, value, hue }: { label: string; value: string; hue?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.stat, { borderColor: p.line, backgroundColor: p.card }]}>
      <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: p.muted }}>{label}</AppText>
      <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 18, lineHeight: 25, color: hue ?? p.ink, writingDirection: "ltr", alignSelf: "flex-start" }}>
        {value}
      </AppText>
    </View>
  );
}

/** The fleet at a glance (the web's DetailStrip on /brains): brains, memories,
 *  graph nodes, recalls in the last 24h (ok-green when any), open gaps (warn
 *  when any). Three tiles on the first line, two on the second. */
export function StatsStrip({ stats, fallbackBrains, loading }: { stats?: BrainStats; fallbackBrains?: number; loading?: boolean }) {
  const p = usePalette();
  const { t } = useI18n();
  const v = (n?: number) => (loading || n === undefined ? "—" : formatCount(n));
  return (
    <Row>
      <AppText variant="micro">{t("brains.overview")}</AppText>
      <View style={styles.grid}>
        <Stat label={t("brains.stat.brains")} value={v(stats?.brains ?? fallbackBrains)} />
        <Stat label={t("brains.stat.memories")} value={v(stats?.memories)} />
        <Stat label={t("brains.stat.nodes")} value={v(stats?.entities)} />
        <Stat label={t("brains.stat.recalls24h")} value={v(stats?.recalls24h)} hue={stats?.recalls24h ? p.ok : undefined} />
        <Stat label={t("brains.stat.openGaps")} value={v(stats?.openGaps)} hue={stats?.openGaps ? p.warn : undefined} />
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexBasis: "30%", flexGrow: 1, borderWidth: 1, borderRadius: metrics.radius.control, paddingVertical: 9, paddingHorizontal: 12, gap: 2 },
});
