import { Pressable, StyleSheet, View } from "react-native";

import { ForwardChevron } from "@/components/kit";
import { AppText } from "@/components/ui";
import { BrainAvatar } from "@/features/brains/brain-avatar";
import { brainName, ltr } from "@/features/brains/brains-core";
import type { Recalled } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, usePalette } from "@/theme";

import { hitMeta } from "./search-core";

/** The brain a hit came from, as a small avatar + name chip. */
function BrainChip({ namespace, bordered }: { namespace: string; bordered: boolean }) {
  const p = usePalette();
  const { brains } = useBrains();
  const brain = brains.find((b) => b.namespace === namespace);
  return (
    <View style={[styles.brainChip, bordered ? { borderWidth: 1, borderColor: p.line, backgroundColor: p.card } : { paddingStart: 0 }]}>
      <BrainAvatar brain={brain ?? { namespace }} size={18} />
      <AppText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: p.body }}>
        {brain ? brainName(brain) : ltr(namespace)}
      </AppText>
    </View>
  );
}

function Score({ value }: { value: number }) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <AppText
      accessibilityLabel={`${t("search.score")} ${value.toFixed(2)}`}
      style={{ fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 17, color: p.gold, writingDirection: "ltr" }}
    >
      {value.toFixed(2)}
    </AppText>
  );
}

/**
 * One recall hit: brain chip + score, up to four lines of content, then
 * type · source. `variant="classic"` is the house row (soft divider between
 * hits); `"inset"` is the iOS 26 inset-grouped cell (the caller draws the
 * group card and separators).
 */
export function SearchHit({ item, last, onOpen, variant = "classic", showBrain = false }: {
  item: Recalled;
  last: boolean;
  onOpen?: () => void;
  variant?: "classic" | "inset";
  /** Show the brain chip — off when the hits are already grouped by brain. */
  showBrain?: boolean;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const inset = variant === "inset";
  const meta = hitMeta(item);
  const row = (
    <View style={[inset ? styles.insetHit : styles.hit, !inset && !last && { borderBottomWidth: 1, borderBottomColor: p.soft }]}>
      <View style={styles.hitTop}>
        {showBrain && item.namespace ? <BrainChip namespace={item.namespace} bordered={!inset} /> : null}
        <View style={{ flex: 1 }} />
        <Score value={item.score} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <AppText numberOfLines={4} style={{ flex: 1, fontFamily: fonts.light, fontSize: inset ? 15 : 14, lineHeight: 24, color: p.ink }}>
          {item.content}
        </AppText>
        {onOpen ? <ForwardChevron /> : null}
      </View>
      {meta ? (
        <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: p.muted, writingDirection: "ltr", alignSelf: "flex-start" }}>
          {meta}
        </AppText>
      ) : null}
    </View>
  );
  // Inset cells get the iOS separator: a hairline starting at the text inset.
  const body = inset && !last ? (
    <View>
      {row}
      <View style={{ height: StyleSheet.hairlineWidth, marginStart: 16, backgroundColor: p.line }} />
    </View>
  ) : row;
  if (!onOpen) return body;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityHint={t("search.openNote")}
      android_ripple={{ color: p.soft }}
      style={inset ? ({ pressed }) => ({ backgroundColor: pressed ? p.soft : "transparent" }) : undefined}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { paddingVertical: 14, gap: 8 },
  insetHit: { paddingVertical: 13, paddingHorizontal: 16, gap: 7 },
  hitTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  brainChip: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 26, paddingStart: 4, paddingEnd: 9, borderRadius: metrics.radius.chip, maxWidth: "75%" },
});
