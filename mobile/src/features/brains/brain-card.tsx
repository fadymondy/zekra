import { CircleCheck, CircleHelp, Ellipsis } from "lucide-react-native";
import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Bar, ForwardChevron } from "@/components/kit";
import { AppText, Row } from "@/components/ui";
import { BrainAvatar } from "@/features/brains/brain-avatar";
import { useBrainDetail } from "@/features/brains/brain-data";
import { brainHex, brainName, formatAgo, formatCount, ltr, topTypes, type BrainListItem } from "@/features/brains/brains-core";
import { useI18n, type TKey } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

/** A small bordered tag (§1.11 badge): Lusail in Arabic, never mono there. */
export function Tag({ label, hue, icon, mono }: { label: string; hue?: string; icon?: ReactNode; mono?: boolean }) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const color = hue ?? p.body;
  return (
    <View style={[styles.tag, { borderColor: hue ? `${hue}55` : p.line, backgroundColor: hue ? `${hue}1A` : p.card }]}>
      {icon}
      <AppText numberOfLines={1} style={{ fontFamily: mono && !isRtl ? fonts.mono : fonts.regular, fontSize: 11, lineHeight: 17, color }}>
        {label}
      </AppText>
    </View>
  );
}

function Metric({ value, label, first }: { value: string; label: string; first?: boolean }) {
  const p = usePalette();
  return (
    <View style={[styles.metric, first ? { paddingStart: 0 } : { borderStartWidth: 1, borderStartColor: p.soft }]}>
      <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 15, lineHeight: 22, color: p.ink, writingDirection: "ltr", alignSelf: "flex-start" }}>
        {value}
      </AppText>
      <AppText variant="micro" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

const ROLE_KEYS: Record<string, TKey> = {
  admin: "brains.role.admin",
  owner: "brains.role.owner",
  editor: "brains.role.editor",
  viewer: "brains.role.viewer",
};

/**
 * A brain as a full-bleed row (the web's BrainCard, in the mobile house
 * style): a 2px rule in the brain's colour on top; avatar, name, namespace +
 * last update, role; two lines of description; memories · recalls · types;
 * the top entity types; open gaps and "Open". Detail loads lazily per card.
 */
export const BrainCard = memo(function BrainCard({ brain, onOpen, onMenu }: {
  brain: BrainListItem;
  onOpen: (ns: string) => void;
  onMenu: (brain: BrainListItem) => void;
}) {
  const p = usePalette();
  const { t, locale, isRtl } = useI18n();
  const detail = useBrainDetail(brain.namespace).data;
  const hex = brainHex(brain);
  const name = brainName(brain);
  const types = topTypes(detail?.types);
  const roleKey = brain.role ? ROLE_KEYS[brain.role] : undefined;

  return (
    <Row
      onPress={() => onOpen(brain.namespace)}
      onLongPress={() => onMenu(brain)}
      accessibilityLabel={t("brains.openBrain", { brain: name })}
    >
      <View pointerEvents="none" style={[styles.rule, { backgroundColor: hex || p.action, opacity: hex ? 1 : 0.55 }]} />

      <View style={styles.head}>
        <BrainAvatar brain={brain} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameLine}>
            <AppText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 24, color: p.ink }}>
              {name}
            </AppText>
            {roleKey ? <Tag label={t(roleKey)} /> : null}
          </View>
          {/* One run so it wraps like prose; the namespace is an LTR isolate in mono. */}
          <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 18, color: p.muted }}>
            {name !== brain.namespace ? (
              <>
                <AppText style={{ fontFamily: fonts.mono, fontSize: 11, color: p.muted }}>{ltr(brain.namespace)}</AppText>
                {"  ·  "}
              </>
            ) : null}
            {t("brains.updated", { when: formatAgo(brain.lastAt, locale) })}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("brains.menu.label", { brain: name })}
          onPress={() => onMenu(brain)}
          hitSlop={8}
          style={({ pressed }) => [styles.more, { borderColor: p.line, backgroundColor: pressed ? p.card : "transparent" }]}
        >
          <Ellipsis size={17} color={p.muted} strokeWidth={1.6} />
        </Pressable>
      </View>

      {brain.description ? (
        <AppText numberOfLines={2} style={{ fontFamily: fonts.light, fontSize: 13, lineHeight: isRtl ? 24 : 21, color: p.body }}>
          {brain.description}
        </AppText>
      ) : null}

      <View style={[styles.metrics, { borderColor: p.soft }]}>
        <Metric first value={formatCount(brain.memories)} label={t("brains.metric.memories")} />
        <Metric value={detail ? formatCount(detail.recalls) : "—"} label={t("brains.metric.recalls")} />
        <Metric value={detail ? formatCount(Object.keys(detail.types ?? {}).length) : "—"} label={t("brains.metric.types")} />
      </View>

      <View style={styles.types}>
        {!detail ? (
          <>
            <Bar width={72} height={24} />
            <Bar width={56} height={24} />
            <Bar width={64} height={24} />
          </>
        ) : types.top.length === 0 ? (
          <AppText style={{ fontFamily: fonts.regular, fontSize: 12, lineHeight: 24, color: p.muted }}>{t("brains.noTypes")}</AppText>
        ) : (
          <>
            {types.top.map(([type, n]) => (
              <View key={type} style={[styles.tag, { borderColor: p.line, backgroundColor: p.card }]}>
                <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: p.body }}>{type}</AppText>
                <AppText style={{ fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 17, color: p.muted, writingDirection: "ltr" }}>{formatCount(n)}</AppText>
              </View>
            ))}
            {types.rest > 0 ? (
              <AppText style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 24, color: p.muted }}>{ltr(`+${types.rest}`)}</AppText>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: p.soft }]}>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          {!detail ? null : detail.openGaps > 0 ? (
            <Tag
              hue={p.warn}
              icon={<CircleHelp size={12} color={p.warn} strokeWidth={1.8} />}
              label={detail.openGaps === 1 ? t("brains.openGapOne") : t("brains.openGapMany", { count: formatCount(detail.openGaps) })}
            />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <CircleCheck size={14} color={p.ok} strokeWidth={1.7} />
              <AppText style={{ fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: p.muted }}>{t("brains.noGaps")}</AppText>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <AppText style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: p.muted }}>{t("brains.open")}</AppText>
          <ForwardChevron size={17} />
        </View>
      </View>
    </Row>
  );
});

/** Card-shaped loading placeholder. */
export function BrainCardSkeleton() {
  const p = usePalette();
  return (
    <Row>
      <View style={styles.head}>
        <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: p.soft }} />
        <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
          <Bar width="58%" height={13} />
          <Bar width="40%" height={10} />
        </View>
      </View>
      <Bar width="86%" />
      <View style={[styles.metrics, { borderColor: p.soft }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.metric, i === 0 ? { paddingStart: 0 } : { borderStartWidth: 1, borderStartColor: p.soft }]}>
            <Bar width={40} height={13} />
            <Bar width={56} height={8} />
          </View>
        ))}
      </View>
      <View style={styles.types}>
        <Bar width={72} height={24} />
        <Bar width={56} height={24} />
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  rule: { position: "absolute", top: -1, start: 0, end: 0, height: 2 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 13 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  more: { width: 32, height: 32, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center", marginTop: 2 },
  metrics: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1 },
  metric: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  types: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, minHeight: 26 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24, paddingHorizontal: 8, borderRadius: metrics.radius.chip, borderWidth: 1 },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 12, marginTop: -2 },
});
