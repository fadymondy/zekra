import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PropsWithChildren, ReactNode } from "react";

import { usePalette } from "@/theme";

export function Screen({ children, style }: PropsWithChildren<{ style?: ViewProps["style"] }>) {
  const p = usePalette();
  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: p.bg }, style]}>
      <View pointerEvents="none" style={[styles.leftRail, { borderColor: p.line }]} />
      <View pointerEvents="none" style={[styles.rightRail, { borderColor: p.line }]} />
      {children}
    </SafeAreaView>
  );
}

export function HatchBand({ label }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.hatch, { backgroundColor: p.soft, borderColor: p.line }]}>
      {Array.from({ length: 24 }, (_, index) => <View key={index} style={[styles.hatchLine, { left: index * 18 - 18, backgroundColor: p.line }]} />)}
      {label ? <Text style={[styles.hatchLabel, { color: p.muted, backgroundColor: p.soft }]}>{label.toUpperCase()}</Text> : null}
    </View>
  );
}

export function Header({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={[styles.header, { borderColor: p.line, backgroundColor: p.bg }]}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text numberOfLines={1} style={[styles.eyebrow, { color: p.muted }]}>{eyebrow.toUpperCase()}</Text> : null}
        <Text numberOfLines={1} style={[styles.title, { color: p.ink }]}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function Button({ label, loading, tone = "primary", style, disabled, ...props }: PressableProps & { label: string; loading?: boolean; tone?: "primary" | "quiet" | "danger" }) {
  const p = usePalette();
  const primary = tone === "primary";
  const danger = tone === "danger";
  const backgroundColor = primary ? p.action : p.card;
  const color = primary ? p.onAction : danger ? p.danger : p.ink;
  const borderColor = primary ? p.action : danger ? p.danger : p.line;
  return (
    <Pressable disabled={disabled || loading} style={(state) => [styles.button, { backgroundColor, borderColor, opacity: disabled || loading ? 0.5 : state.pressed ? 0.72 : 1 }, typeof style === "function" ? style(state) : style]} {...props}>
      {loading ? <ActivityIndicator color={color} size="small" /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, multiline, style, ...props }: TextInputProps & { label: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 7 }}>
      <Text style={[styles.label, { color: p.muted }]}>{label.toUpperCase()}</Text>
      <TextInput
        placeholderTextColor={p.muted}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline && styles.multiline, { color: p.ink, borderColor: p.line, backgroundColor: p.card }, style]}
        {...props}
      />
    </View>
  );
}

export function StatePanel({ title, body, loading }: { title: string; body?: string; loading?: boolean }) {
  const p = usePalette();
  return (
    <View style={[styles.state, { borderColor: p.line, backgroundColor: p.bg }]}>
      {loading ? <ActivityIndicator color={p.action} /> : null}
      <Text style={[styles.stateTitle, { color: p.ink }]}>{title}</Text>
      {body ? <Text style={[styles.stateBody, { color: p.muted }]}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  leftRail: { position: "absolute", top: 0, bottom: 0, left: 16, borderLeftWidth: StyleSheet.hairlineWidth, zIndex: 20 },
  rightRail: { position: "absolute", top: 0, bottom: 0, right: 16, borderRightWidth: StyleSheet.hairlineWidth, zIndex: 20 },
  header: { minHeight: 84, marginHorizontal: 16, paddingHorizontal: 16, paddingVertical: 13, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12 },
  eyebrow: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 9, letterSpacing: 1.9, fontWeight: "700", marginBottom: 5 },
  title: { fontSize: 28, fontWeight: "500", letterSpacing: -0.7 },
  hatch: { height: 20, marginHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  hatchLine: { position: "absolute", top: -12, width: 1, height: 46, transform: [{ rotate: "45deg" }], opacity: 0.85 },
  hatchLabel: { paddingHorizontal: 9, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 8, letterSpacing: 1.5 },
  button: { minHeight: 44, paddingHorizontal: 16, borderRadius: 0, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  buttonText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.25 },
  label: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 9, letterSpacing: 1.5, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 0, paddingHorizontal: 13, fontSize: 16 },
  multiline: { minHeight: 180, paddingTop: 12 },
  state: { flex: 1, minHeight: 180, marginHorizontal: 16, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, padding: 30, alignItems: "center", justifyContent: "center", gap: 9 },
  stateTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  stateBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
