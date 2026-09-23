import {
  Bold,
  ChevronDown,
  Code2,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useI18n } from "@/lib/i18n";
import { metrics, usePalette } from "@/theme";

import type { EngineMode, ToolbarCommand, ToolbarState } from "./bridge-core";

/*
The formatting bar that rides on top of the keyboard (MH-368). React Native
has no InputAccessoryView for a WebView, so the note screen lifts this bar by
the keyboard's overlap (use-keyboard-inset.ts) and the WebView's own iOS
accessory bar is hidden (hideKeyboardAccessoryView).

Direction-aware: the row itself flips with the root `direction`, and the
glyphs that encode a direction (lists, quote, undo/redo) are mirrored in RTL
the way iOS mirrors them.
*/

type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

type Item = {
  key: string;
  label: string;
  Icon: IconType;
  active?: boolean;
  disabled?: boolean;
  mirror?: boolean;
  onPress: () => void;
};

export function EditorToolbar({ state, mode, uploading, onCommand, onLink, onImage, onDone }: {
  state: ToolbarState | null;
  mode: EngineMode | null;
  uploading: boolean;
  onCommand: (command: ToolbarCommand) => void;
  onLink: () => void;
  onImage: () => void;
  onDone: () => void;
}) {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const s = state;
  const rich = mode === "rich";
  const HeadingIcon: IconType = s?.heading === 1 ? Heading1 : s?.heading === 2 ? Heading2 : s?.heading === 3 ? Heading3 : Heading;

  const cmd = (key: ToolbarCommand, label: string, Icon: IconType, active?: boolean, mirror?: boolean): Item => ({
    key,
    label,
    Icon,
    active,
    mirror,
    onPress: () => onCommand(key),
  });

  const items: Item[] = rich
    ? [
        cmd("bold", t("editor.tb.bold"), Bold, s?.bold),
        cmd("italic", t("editor.tb.italic"), Italic, s?.italic),
        cmd("strike", t("editor.tb.strike"), Strikethrough, s?.strike),
        cmd("heading", t("editor.tb.heading"), HeadingIcon, !!s?.heading),
        cmd("bulletList", t("editor.tb.bulletList"), List, s?.bulletList, true),
        cmd("orderedList", t("editor.tb.orderedList"), ListOrdered, s?.orderedList, true),
        cmd("taskList", t("editor.tb.taskList"), ListChecks, s?.taskList, true),
        cmd("blockquote", t("editor.tb.quote"), Quote, s?.blockquote, true),
        cmd("codeBlock", t("editor.tb.codeBlock"), Code2, s?.codeBlock),
        { key: "link", label: t("editor.tb.link"), Icon: Link2, active: !!s?.link, onPress: onLink },
        { key: "image", label: t("editor.tb.image"), Icon: ImagePlus, disabled: uploading, onPress: onImage },
        { key: "undo", label: t("editor.tb.undo"), Icon: Undo2, disabled: s ? !s.canUndo : false, mirror: true, onPress: () => onCommand("undo") },
        { key: "redo", label: t("editor.tb.redo"), Icon: Redo2, disabled: s ? !s.canRedo : false, mirror: true, onPress: () => onCommand("redo") },
      ]
    : [{ key: "image", label: t("editor.tb.image"), Icon: ImagePlus, disabled: uploading, onPress: onImage }];

  return (
    <View style={[styles.bar, { backgroundColor: p.card, borderTopColor: p.line }]}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        style={{ flex: 1 }}
      >
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: !!item.active, disabled: !!item.disabled }}
            disabled={item.disabled}
            onPress={item.onPress}
            hitSlop={4}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: item.active ? `${p.action}1F` : pressed ? p.soft : "transparent",
                borderColor: item.active ? p.action : "transparent",
                opacity: item.disabled ? 0.35 : 1,
              },
            ]}
          >
            {item.key === "image" && uploading ? (
              <ActivityIndicator size="small" color={p.action} />
            ) : (
              <View style={item.mirror && isRtl ? styles.mirror : undefined}>
                <item.Icon size={19} color={item.active ? p.action : p.ink} strokeWidth={1.7} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <View style={[styles.divider, { backgroundColor: p.line }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={t("editor.tb.done")} onPress={onDone} hitSlop={4} style={styles.btn}>
        <ChevronDown size={20} color={p.muted} strokeWidth={1.7} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, minHeight: 48, paddingHorizontal: 6 },
  scroll: { alignItems: "center", gap: 2, paddingHorizontal: 2 },
  btn: { width: 40, height: 38, borderRadius: metrics.radius.control, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  divider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 4 },
  mirror: { transform: [{ scaleX: -1 }] },
});
