import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Bar, ForwardChevron } from "@/components/kit";
import { AppText, Cell } from "@/components/ui";
import { BrainAvatar } from "@/features/brains/brain-avatar";
import { brainName, formatAgo, formatCount, type BrainListItem } from "@/features/brains/brains-core";
import { useI18n, type TKey } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

export const ROLE_KEYS: Record<string, TKey> = {
  admin: "brains.role.admin",
  owner: "brains.role.owner",
  editor: "brains.role.editor",
  viewer: "brains.role.viewer",
};

const AVATAR = 38;
/** Dividers start under the text, past the avatar (iOS / Finder lists). */
const TEXT_INSET = 16 + AVATAR + 12;

/**
 * A brain in the Brains list — the desktop's Finder-style row
 * (desktop/src/renderer/routes/brains.tsx) as a grouped-list cell: avatar;
 * name, then its description (or namespace); memories and last update at the
 * end. Tap opens the brain; long-press opens its actions.
 */
export const BrainRow = memo(function BrainRow({ brain, first, last, onOpen, onMenu }: {
  brain: BrainListItem;
  first: boolean;
  last: boolean;
  onOpen: (ns: string) => void;
  onMenu: (brain: BrainListItem) => void;
}) {
  const p = usePalette();
  const { t, locale } = useI18n();
  const name = brainName(brain);
  const roleKey = brain.role ? ROLE_KEYS[brain.role] : undefined;
  const sub = brain.description || brain.namespace;

  return (
    <Cell first={first} last={last} dividerInset={TEXT_INSET}>
      <Pressable
        onPress={() => onOpen(brain.namespace)}
        onLongPress={() => onMenu(brain)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={t("brains.openBrain", { brain: name })}
        accessibilityActions={[{ name: "longpress", label: t("brains.menu.label", { brain: name }) }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && onMenu(brain)}
        android_ripple={{ color: p.selected }}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.selected }]}
      >
        <BrainAvatar brain={brain} size={AVATAR} />
        <View style={styles.text}>
          <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: p.ink }}>{name}</AppText>
          <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: p.muted }}>
            {roleKey ? `${t(roleKey)} · ` : ""}
            {sub}
          </AppText>
        </View>
        <View style={styles.end}>
          <AppText style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: p.body, writingDirection: "ltr" }}>{formatCount(brain.memories)}</AppText>
          <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{formatAgo(brain.lastAt, locale)}</AppText>
        </View>
        <ForwardChevron size={16} />
      </Pressable>
    </Cell>
  );
});

/** Loading placeholder in the same shape. */
export function BrainRowSkeleton({ first, last }: { first: boolean; last: boolean }) {
  const p = usePalette();
  return (
    <Cell first={first} last={last} dividerInset={TEXT_INSET}>
      <View style={styles.row}>
        <View style={{ width: AVATAR, height: AVATAR, borderRadius: 9, backgroundColor: p.field }} />
        <View style={[styles.text, { gap: 8 }]}>
          <Bar width="55%" height={12} />
          <Bar width="35%" height={10} />
        </View>
      </View>
    </Cell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 62 },
  text: { flex: 1, gap: 1 },
  end: { alignItems: "flex-end", gap: 1, maxWidth: 110 },
});
