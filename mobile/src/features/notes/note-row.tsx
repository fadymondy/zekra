import * as Haptics from "expo-haptics";
import { AlertTriangle, Archive, ArchiveRestore, Pin, PinOff, Sparkles, Trash2, type LucideIcon } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef } from "react";
import { I18nManager, Pressable, StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Meta, Tile } from "@/components/kit";
import { AppText, Row } from "@/components/ui";
import type { Note } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { noteIcon } from "@/lib/note-icon";
import { fonts, useTheme } from "@/theme";

import { formatAgo } from "./format";
import { edgeFromTravel, edgeOf, fullSwipeArmed, physicalOrder, rowPreview, type Edge, type Physical } from "./notes-core";

/** Keeps at most one row swiped open across the list. */
export type OpenRowRegistry = {
  claim(row: SwipeableMethods): void;
  release(row: SwipeableMethods): void;
  closeAll(): void;
};

type SwipeAction = { key: string; label: string; Icon: LucideIcon; ground: string; ink: string; run: () => void };

const ACTION_W = 84;

/*
One button panel behind a swiped row. The panel is laid out with an explicit
LTR direction and its buttons are already in physical order (physicalOrder),
so the app's RTL root cannot mirror it a second time.

Dragging past the open position stretches the OUTER button toward the row and,
past fullSwipeArmed(), arms it: a haptic tick, and releasing fires it (MH-363).
The panel's own width grows with it, so nothing overflows its bounds.
*/
function ActionPanel({ physical, actions, translation, rowWidth, onArm, close }: {
  physical: Physical;
  actions: SwipeAction[];
  translation: SharedValue<number>;
  rowWidth: SharedValue<number>;
  onArm: (armed: boolean) => void;
  close: () => void;
}) {
  const width = actions.length * ACTION_W;
  const outer = physical === "left" ? 0 : actions.length - 1;
  // The left panel is uncovered by positive travel, the right by negative.
  const sign = physical === "left" ? 1 : -1;

  useAnimatedReaction(
    () => fullSwipeArmed(sign * translation.value, width, rowWidth.value),
    (armed, previous) => {
      if (previous !== null && armed !== previous) scheduleOnRN(onArm, armed);
    },
  );
  const panelStyle = useAnimatedStyle(() => ({ width: width + Math.max(0, sign * translation.value - width) }));
  const outerStyle = useAnimatedStyle(() => ({ width: ACTION_W + Math.max(0, sign * translation.value - width) }));

  return (
    <Animated.View style={[styles.panel, { justifyContent: physical === "left" ? "flex-start" : "flex-end" }, panelStyle]}>
      {actions.map((action, i) => (
        <Animated.View key={action.key} style={i === outer ? outerStyle : { width: ACTION_W }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              close();
              action.run();
            }}
            style={({ pressed }) => [styles.action, { backgroundColor: action.ground, opacity: pressed ? 0.8 : 1 }]}
          >
            <action.Icon size={20} color={action.ink} strokeWidth={1.8} />
            <AppText numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 13.5, color: action.ink }}>{action.label}</AppText>
          </Pressable>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

/**
 * A note in the brain's list.
 *   tap        -> open
 *   long press -> the action sheet (onMenu), with a haptic
 *   swipe      -> real buttons: Pin at the start edge; Archive and Delete at
 *                 the end edge. A full swipe fires the outer one (Pin/Archive).
 * Swipe is off for read-only brains. Archive/Delete confirm in the handlers
 * (useNoteActions), so every entry point shares one prompt.
 */
export const NoteRow = memo(function NoteRow({ note, canWrite, registry, onOpen, onMenu, onPin, onArchive, onDelete }: {
  note: Note;
  canWrite: boolean;
  registry: OpenRowRegistry;
  onOpen: (note: Note) => void;
  onMenu: (note: Note) => void;
  onPin: (note: Note) => void;
  onArchive: (note: Note) => void;
  onDelete: (note: Note) => void;
}) {
  const { palette: p, scheme } = useTheme();
  const { t, isRtl, locale } = useI18n();
  const swipe = useRef<SwipeableMethods>(null);
  const rowWidth = useSharedValue(0);
  const armed = useRef<Edge | null>(null);

  const close = useCallback(() => swipe.current?.close(), []);
  const title = note.title.trim() || t("notes.x.untitled");
  const preview = useMemo(() => rowPreview({ description: note.description, body: note.body }), [note.description, note.body]);
  const { Icon, color } = noteIcon({ category: note.category, icon: note.icon, color: note.color }, p.muted);

  // Gold carries dark text in both themes: ink is dark only in light mode.
  const onGold = scheme === "dark" ? p.bg : p.ink;
  const actions: Record<Edge, SwipeAction[]> = {
    start: [
      { key: "pin", label: note.pinned ? t("notes.x.unpin") : t("notes.x.pin"), Icon: note.pinned ? PinOff : Pin, ground: p.gold, ink: onGold, run: () => onPin(note) },
    ],
    // Inner -> outer. Archive is outer: it is the full-swipe action, and it is
    // reversible, so a swipe that goes too far never costs a note.
    end: [
      { key: "delete", label: t("notes.x.delete"), Icon: Trash2, ground: p.danger, ink: p.onAction, run: () => onDelete(note) },
      {
        key: "archive",
        label: note.archived ? t("notes.x.unarchive") : t("notes.x.archive"),
        Icon: note.archived ? ArchiveRestore : Archive,
        ground: p.soft,
        ink: p.ink,
        run: () => onArchive(note),
      },
    ],
  };
  const primary: Record<Edge, () => void> = { start: () => onPin(note), end: () => onArchive(note) };

  const arm = (edge: Edge) => (on: boolean) => {
    if (on) {
      armed.current = edge;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (armed.current === edge) {
      armed.current = null;
    }
  };

  const panel = (physical: Physical) => (_progress: SharedValue<number>, translation: SharedValue<number>) => {
    const edge = edgeOf(physical, isRtl);
    return (
      <ActionPanel
        physical={physical}
        actions={physicalOrder(actions[edge], physical)}
        translation={translation}
        rowWidth={rowWidth}
        onArm={arm(edge)}
        close={close}
      />
    );
  };

  const onLayout = (e: LayoutChangeEvent) => {
    rowWidth.value = e.nativeEvent.layout.width;
  };

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    switch (e.nativeEvent.actionName) {
      case "activate":
        return onOpen(note);
      case "longpress":
        return onMenu(note);
      case "pin":
        return onPin(note);
      case "archive":
        return onArchive(note);
      case "delete":
        return onDelete(note);
    }
  };

  return (
    <ReanimatedSwipeable
      ref={swipe}
      enabled={canWrite}
      renderLeftActions={canWrite ? panel("left") : undefined}
      renderRightActions={canWrite ? panel("right") : undefined}
      friction={1}
      overshootFriction={1.4}
      // The library lays its panels out by I18nManager.isRTL, which only
      // follows the app's language from the next launch. Pin its container to
      // that direction so its measurements hold, and give the row itself the
      // app's direction back.
      containerStyle={{ direction: I18nManager.isRTL ? "rtl" : "ltr" }}
      childrenContainerStyle={{ direction: isRtl ? "rtl" : "ltr" }}
      onSwipeableOpenStartDrag={() => swipe.current && registry.claim(swipe.current)}
      onSwipeableWillOpen={(direction) => {
        const edge = edgeFromTravel((direction as string) === "right" ? "right" : "left", isRtl);
        if (armed.current !== edge) return;
        armed.current = null;
        close();
        primary[edge]();
      }}
      onSwipeableClose={() => swipe.current && registry.release(swipe.current)}
    >
      <Pressable
        onLayout={onLayout}
        onPress={() => onOpen(note)}
        onLongPress={() => onMenu(note)}
        delayLongPress={350}
        android_ripple={{ color: p.soft }}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityActions={[
          { name: "activate" },
          { name: "longpress", label: t("notes.x.more") },
          ...(canWrite
            ? [
                { name: "pin", label: note.pinned ? t("notes.x.unpin") : t("notes.x.pin") },
                { name: "archive", label: note.archived ? t("notes.x.unarchive") : t("notes.x.archive") },
                { name: "delete", label: t("notes.x.delete") },
              ]
            : []),
        ]}
        onAccessibilityAction={onAccessibilityAction}
      >
        <Row>
          <View style={styles.line}>
            {/* hsl() colours (uncurated categories) cannot take the hex alpha
                suffix Tile's tint uses, so only hex colours tint the tile. */}
            <Tile size={38} tint={color.startsWith("#") ? color : undefined}>
              <Icon size={18} color={color} strokeWidth={1.8} />
            </Tile>
            <View style={styles.text}>
              <View style={styles.titleLine}>
                {note.pinned ? <Pin size={13} color={p.gold} fill={p.gold} accessibilityLabel={t("notes.x.pinnedLabel")} /> : null}
                <AppText variant="rowTitle" numberOfLines={1} style={styles.title}>{title}</AppText>
                {!note.indexed ? (
                  note.indexError ? (
                    <AlertTriangle size={14} color={p.danger} accessibilityLabel={t("notes.x.indexFailed")} />
                  ) : (
                    <Sparkles size={14} color={p.gold} accessibilityLabel={t("notes.x.indexing")} />
                  )
                ) : null}
              </View>
              {preview ? <AppText variant="body" numberOfLines={2}>{preview}</AppText> : null}
              <Meta
                items={[
                  formatAgo(note.updatedAt, t, locale),
                  note.archived && t("notes.x.archivedLabel").toUpperCase(),
                  ...note.tags.slice(0, 3).map((tag) => `#${tag}`),
                ]}
              />
            </View>
          </View>
        </Row>
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const styles = StyleSheet.create({
  panel: { flexDirection: "row", direction: "ltr" },
  action: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 6 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  text: { flex: 1, gap: 4 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 },
  title: { flexShrink: 1 },
});
