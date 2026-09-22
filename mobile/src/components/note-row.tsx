import { Archive, ArchiveRestore, AlertTriangle, Pin, PinOff, Sparkles, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";

import { NoteAppearanceSheet, type AppearancePatch } from "@/components/note-appearance-sheet";
import { AppText, Row } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import type { Note } from "@/lib/api";
import { noteIcon } from "@/lib/note-icon";
import { metrics, usePalette } from "@/theme";

export type NoteAction = "pin" | "archive" | "delete";

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString();
}

/**
 * A note row with the three interactions the product asks for:
 *   - swipe       -> start side pins, end side archives
 *   - long press  -> the action menu (the mobile equivalent of a context menu)
 *   - tap         -> open
 * Archive and delete confirm first; pin is trivially reversible so it applies
 * immediately. The confirmations live here so every entry point (swipe, long
 * press) goes through the same prompt.
 */
export function NoteRow({ note, onOpen, onAction, onAppearance }: {
  note: Note;
  onOpen: () => void;
  onAction: (action: NoteAction) => void;
  onAppearance?: (patch: AppearancePatch) => void;
}) {
  const p = usePalette();
  const { Icon: CategoryIcon, color: categoryTint } = noteIcon(
    { category: note.category, icon: note.icon, color: note.color },
    p.muted,
  );
  const { t, isRtl } = useI18n();
  const swipe = useRef<Swipeable>(null);
  const [appearance, setAppearance] = useState(false);

  const close = () => swipe.current?.close();

  function confirmArchive() {
    close();
    Alert.alert(
      note.archived ? t("row.unarchiveConfirm") : t("row.archiveConfirm"),
      note.archived ? t("row.unarchiveBody") : t("row.archiveBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: note.archived ? t("row.unarchive") : t("row.archive"), onPress: () => onAction("archive") },
      ],
    );
  }

  function confirmDelete() {
    close();
    Alert.alert(t("note.deleteConfirm"), t("note.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => onAction("delete") },
    ]);
  }

  function openMenu() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(note.title || t("common.untitled"), undefined, [
      { text: note.pinned ? t("row.unpin") : t("row.pin"), onPress: () => onAction("pin") },
      ...(onAppearance ? [{ text: t("row.appearance"), onPress: () => setAppearance(true) }] : []),
      { text: note.archived ? t("row.unarchive") : t("row.archive"), onPress: confirmArchive },
      { text: t("common.delete"), style: "destructive", onPress: confirmDelete },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  const pinAction = () => (
    <View style={[styles.action, { backgroundColor: p.gold }]}>
      {note.pinned ? <PinOff color={p.ink} size={20} /> : <Pin color={p.ink} size={20} />}
      <AppText variant="micro" color={p.ink}>{note.pinned ? t("row.unpin") : t("row.pin")}</AppText>
    </View>
  );

  const archiveAction = () => (
    <View style={[styles.action, { backgroundColor: p.soft }]}>
      {note.archived ? <ArchiveRestore color={p.body} size={20} /> : <Archive color={p.body} size={20} />}
      <AppText variant="micro">{note.archived ? t("row.unarchive") : t("row.archive")}</AppText>
    </View>
  );

  const snippet = (note.body || "").replace(/[#>*_`[\]]/g, "").replace(/\s+/g, " ").trim();

  return (
    <Swipeable
      ref={swipe}
      // RTL mirrors the gesture, so swap which side renders which action.
      renderLeftActions={isRtl ? archiveAction : pinAction}
      renderRightActions={isRtl ? pinAction : archiveAction}
      onSwipeableOpen={(direction) => {
        const pinned = isRtl ? direction === "right" : direction === "left";
        if (pinned) { close(); onAction("pin"); } else confirmArchive();
      }}
      overshootLeft={false}
      overshootRight={false}
    >
      <Pressable onPress={onOpen} onLongPress={openMenu} delayLongPress={350} android_ripple={{ color: p.soft }}>
        <Row>
          <View style={styles.top}>
            {note.pinned ? <Pin color={p.gold} fill={p.gold} size={14} /> : null}
            <AppText variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
              {note.title || t("common.untitled")}
            </AppText>
            {!note.indexed ? (
              note.indexError ? <AlertTriangle color={p.danger} size={15} /> : <Sparkles color={p.gold} size={15} />
            ) : null}
            <AppText variant="mono">{relativeTime(note.updatedAt)}</AppText>
          </View>
          {snippet ? <AppText variant="body" numberOfLines={2}>{snippet}</AppText> : null}
          <View style={styles.meta}>
            {/* Icon + colour derived from the category (MH-264), sharing the
                map with web so a venture looks like a venture everywhere. */}
            <CategoryIcon color={categoryTint} size={13} strokeWidth={1.8} />
            <AppText variant="micro">{(note.category || "note").toUpperCase()}</AppText>
            {note.archived ? <AppText variant="micro">· {t("note.archived").toUpperCase()}</AppText> : null}
            {note.tags.slice(0, 2).map((tag) => (
              <AppText key={tag} variant="micro" numberOfLines={1} style={[styles.tag, { backgroundColor: p.soft, color: p.body }]}>
                {tag}
              </AppText>
            ))}
          </View>
        </Row>
      </Pressable>
      {onAppearance ? (
        <NoteAppearanceSheet
          visible={appearance}
          icon={note.icon}
          color={note.color}
          category={note.category}
          onChange={(patch) => { setAppearance(false); onAppearance(patch); }}
          onClose={() => setAppearance(false)}
        />
      ) : null}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: { width: 96, alignItems: "center", justifyContent: "center", gap: 4 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 7, height: 7 },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: metrics.radius.chip, maxWidth: 110 },
});
