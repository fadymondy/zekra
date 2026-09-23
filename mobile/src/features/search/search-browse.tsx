import { Check, History, X } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { ForwardChevron, ListItem, TextButton, Tile } from "@/components/kit";
import { AppText, MicroLabel, Row } from "@/components/ui";
import { BrainAvatar } from "@/features/brains/brain-avatar";
import { brainName, formatCount } from "@/features/brains/brains-core";
import type { Brain } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

// The search screen's "browse" state (MH-360) — what shows while the field is
// empty, like Apple Health's category browse: the caller's brains (which are
// also the scope picker) and the recent searches. House rows throughout.

/** The active scope as a removable gold token: "In <brain>  ×". */
export function ScopeChip({ brain, onClear }: { brain: Brain; onClear: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <View style={styles.chipRow}>
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={`${t("nav.scopeIn", { brain: brainName(brain) })}. ${t("nav.scopeAll")}`}
        hitSlop={6}
        style={({ pressed }) => [styles.chip, { borderColor: p.gold, backgroundColor: pressed ? `${p.gold}33` : `${p.gold}1A` }]}
      >
        <BrainAvatar brain={brain} size={20} />
        <AppText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 21, color: p.gold }}>
          {t("nav.scopeIn", { brain: brainName(brain) })}
        </AppText>
        <X size={15} color={p.gold} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}

export function SearchBrowse({ brains, scopeNs, onPickBrain, onOpenBrain, recent, onRecent, onClearRecent }: {
  brains: Brain[];
  scopeNs?: string;
  onPickBrain: (namespace: string) => void;
  onOpenBrain: (namespace: string) => void;
  recent: string[];
  onRecent: (query: string) => void;
  onClearRecent: () => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <>
      {recent.length ? (
        <Row style={{ paddingBottom: 4 }}>
          <MicroLabel trailing={<TextButton label={t("nav.clearRecent")} muted onPress={onClearRecent} />}>{t("nav.recent")}</MicroLabel>
          <View>
            {recent.map((query, i) => (
              <ListItem
                key={query}
                padV={11}
                last={i === recent.length - 1}
                onPress={() => onRecent(query)}
                leading={
                  <Tile size={32} radius={metrics.radius.control} ground="bg">
                    <History size={16} color={p.muted} strokeWidth={1.6} />
                  </Tile>
                }
                trailing={<ForwardChevron />}
              >
                <AppText numberOfLines={1} accessibilityHint={t("nav.rerun")} style={{ fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: p.ink }}>
                  {query}
                </AppText>
              </ListItem>
            ))}
          </View>
        </Row>
      ) : null}
      {brains.length ? (
        <Row style={{ paddingBottom: 4 }}>
          <MicroLabel>{t("nav.brains")}</MicroLabel>
          <AppText style={{ fontFamily: fonts.light, fontSize: 14, lineHeight: 22, color: p.muted, marginTop: -6 }}>{t("nav.browseHint")}</AppText>
          <View>
            {brains.map((brain, i) => {
              const active = brain.namespace === scopeNs;
              return (
                <ListItem
                  key={brain.namespace}
                  padV={12}
                  last={i === brains.length - 1}
                  onPress={() => onPickBrain(brain.namespace)}
                  onLongPress={() => onOpenBrain(brain.namespace)}
                  leading={<BrainAvatar brain={brain} size={36} />}
                  trailing={active ? <Check size={18} color={p.gold} strokeWidth={2} /> : <ForwardChevron />}
                >
                  <AppText
                    numberOfLines={1}
                    accessibilityHint={`${t("nav.scopeBrain")}. ${t("nav.openBrain")}`}
                    accessibilityState={{ selected: active }}
                    style={{ fontFamily: fonts.medium, fontSize: 16.5, lineHeight: 25, color: active ? p.gold : p.ink }}
                  >
                    {brainName(brain)}
                  </AppText>
                  <AppText style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, color: p.muted, alignSelf: "flex-start" }}>
                    {`${formatCount(brain.memories)} ${t("brains.memories")}`}
                  </AppText>
                </ListItem>
              );
            })}
          </View>
        </Row>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: "row", paddingHorizontal: metrics.padX },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 34,
    paddingStart: 6,
    paddingEnd: 11,
    borderWidth: 1,
    borderRadius: 17,
    maxWidth: "100%",
  },
});
