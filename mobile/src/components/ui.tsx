import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type ScrollViewProps, type TextInputProps, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";
import type { PropsWithChildren, ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { fonts, metrics, type, usePalette } from "@/theme";

// Component architecture ported from fadymondy.com-v2/mobile/src/components/ui.tsx:
// a screen is [status-bar spacer][header][hatch-ground content][footer] with two
// full-height rails painted over everything. Rows are full-bleed with hairline
// top/bottom, and the hatch shows through the 16px gaps between them.

type Variant = "bigHeader" | "title" | "rowTitle" | "body" | "meta" | "micro" | "mono";

/** Text with the Lusail scale + automatic writing direction. */
export function AppText({ variant = "body", color, style, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const base: Record<Variant, TextStyle> = {
    bigHeader: { fontFamily: fonts.semibold, fontSize: type.bigHeader, color: p.ink },
    title: { fontFamily: fonts.medium, fontSize: type.title, color: p.ink },
    rowTitle: { fontFamily: fonts.medium, fontSize: type.rowTitle, color: p.ink },
    body: { fontFamily: fonts.regular, fontSize: type.body, color: p.body, lineHeight: 20 },
    meta: { fontFamily: fonts.regular, fontSize: type.meta, color: p.muted },
    micro: { fontFamily: fonts.mono, fontSize: isRtl ? type.microAr : type.micro, color: p.muted },
    mono: { fontFamily: fonts.mono, fontSize: type.meta, color: p.muted },
  };
  return <Text {...rest} style={[base[variant], color ? { color } : null, style, { writingDirection: isRtl ? "rtl" : "ltr" }]} />;
}

/** Two full-height hairlines, inset from each edge, painted above content. */
export function Rails() {
  const p = usePalette();
  return (
    <>
      <View pointerEvents="none" style={[styles.rail, { start: metrics.rail, backgroundColor: p.line }]} />
      <View pointerEvents="none" style={[styles.rail, { end: metrics.rail, backgroundColor: p.line }]} />
    </>
  );
}

/** The −45° hatch ground: a 1px `soft` line every 8px. It is the ground of the
 *  content area, so it only shows in the gaps between rows. */
export function HatchFill({ period = 8, opacity = 1 }: { period?: number; opacity?: number }) {
  const p = usePalette();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="zekra-hatch" patternUnits="userSpaceOnUse" width={period} height={period} patternTransform="rotate(-45)">
            <Line x1={0} y1={0} x2={0} y2={period} stroke={p.soft} strokeWidth={1} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#zekra-hatch)" />
      </Svg>
    </View>
  );
}

/** A full-bleed content row: hairline top and bottom, 16/28 padding, 12 gap. */
export function Row({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const p = usePalette();
  const body = (
    <View
      style={[
        {
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: p.line,
          backgroundColor: p.bg,
          paddingHorizontal: metrics.padX,
          paddingVertical: metrics.padY,
          gap: 12,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: p.soft }}>
      {body}
    </Pressable>
  );
}

/** Rows stacked `gap` apart so the hatch ground shows between them. `inset`
 *  pulls them 8px in from each edge (the home/search variant). */
export function Rows({ children, inset }: { children: ReactNode; inset?: boolean }) {
  return <View style={[{ gap: metrics.gap }, inset && { paddingTop: metrics.gap, paddingHorizontal: 8 }]}>{children}</View>;
}

/** 44px square, 1px border, transparent ground, 8px radius. */
export function IconButton({ children, onPress, label, disabled }: { children: ReactNode; onPress?: () => void; label: string; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconBtn,
        { borderColor: p.line, backgroundColor: pressed ? p.card : "transparent", opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Large header for tab roots: 27/600 title with an optional count, plus actions. */
export function Header({ title, eyebrow, count, actions }: { title: string; eyebrow?: string; count?: number; actions?: ReactNode }) {
  const p = usePalette();
  const { isRtl } = useI18n();
  return (
    <View style={[styles.header, { borderBottomColor: p.line, backgroundColor: p.bg }]}>
      <View style={styles.headerTitle}>
        {eyebrow ? <AppText variant="micro" numberOfLines={1} style={{ marginBottom: 3 }}>{eyebrow.toUpperCase()}</AppText> : null}
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {/* Arabic is never letter-spaced (design rule) — spacing it also makes
              the title measure wider than it renders and truncates. */}
          <AppText variant="bigHeader" numberOfLines={1} style={{ letterSpacing: isRtl ? 0 : -0.27, flexShrink: 1 }}>
            {title}
          </AppText>
          {count !== undefined ? <AppText variant="mono" style={{ marginStart: 7, marginTop: -2 }}>{count}</AppText> : null}
        </View>
      </View>
      {actions ? <View style={styles.headerEnd}>{actions}</View> : null}
    </View>
  );
}

/** A screen: status-bar spacer, header, content on the hatch ground, rails over all. */
export function Screen({ header, footer, children, scroll = false, refreshControl }: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: ScrollViewProps["refreshControl"];
}) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, direction: isRtl ? "rtl" : "ltr" }}>
      <View style={{ height: insets.top }} />
      {header}
      <View style={{ flex: 1 }}>
        <HatchFill />
        {scroll ? (
          <ScrollView contentContainerStyle={{ paddingBottom: metrics.gap }} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
      </View>
      {footer}
      <Rails />
    </View>
  );
}

export function PrimaryButton({ label, loading, icon, style, disabled, ...props }: PressableProps & { label: string; loading?: boolean; icon?: ReactNode }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        { backgroundColor: p.action, opacity: disabled || loading ? 0.5 : state.pressed ? 0.85 : 1 },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={p.onAction} size="small" /> : (
        <>
          {icon}
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 15 }} color={p.onAction}>{label}</AppText>
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ label, loading, icon, selected, tone, style, disabled, ...props }: PressableProps & {
  label: string;
  loading?: boolean;
  icon?: ReactNode;
  /** Filter/choice state — a gold-tinted, gold-bordered button. */
  selected?: boolean;
  tone?: "quiet" | "danger";
}) {
  const p = usePalette();
  const danger = tone === "danger";
  const accent = danger ? p.danger : p.gold;
  const text = danger ? p.danger : selected ? p.gold : p.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        {
          borderWidth: 1,
          borderColor: selected || danger ? accent : p.line,
          // 1A is the reference's 10% tint for the selected ground.
          backgroundColor: selected ? `${p.gold}1A` : state.pressed ? p.soft : p.card,
          opacity: disabled || loading ? 0.5 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={text} size="small" /> : (
        <>
          {icon}
          <AppText style={{ fontFamily: fonts.regular, fontSize: 14.5 }} color={text}>{label}</AppText>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, multiline, style, ...props }: TextInputProps & { label?: string }) {
  const p = usePalette();
  const { isRtl } = useI18n();
  return (
    <View style={{ gap: 7 }}>
      {label ? <AppText variant="micro">{label.toUpperCase()}</AppText> : null}
      <TextInput
        placeholderTextColor={p.muted}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: p.ink,
            borderColor: p.line,
            backgroundColor: p.card,
            fontFamily: fonts.regular,
            textAlign: isRtl ? "right" : "left",
          },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

/** Square-cornered segmented control (theme, language, Edit/Preview). */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <View style={[styles.segmented, { borderColor: p.line, backgroundColor: p.card }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.segment, active && { backgroundColor: p.action }]}>
            <AppText variant="meta" numberOfLines={1} color={active ? p.onAction : p.muted} style={{ fontFamily: fonts.medium }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StatePanel({ title, body, loading }: { title: string; body?: string; loading?: boolean }) {
  const p = usePalette();
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={p.action} /> : null}
      <AppText variant="title" style={{ textAlign: "center" }}>{title}</AppText>
      {body ? <AppText variant="body" style={{ textAlign: "center" }}>{body}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, zIndex: 20 },
  header: { minHeight: 72, paddingHorizontal: metrics.padX, paddingVertical: 12, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { flex: 1 },
  headerEnd: { flexDirection: "row", gap: 8 },
  iconBtn: { width: metrics.touch, height: metrics.touch, borderWidth: 1, borderRadius: metrics.radius.control, alignItems: "center", justifyContent: "center" },
  button: { minHeight: metrics.button, borderRadius: metrics.radius.control, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  input: { minHeight: metrics.input, borderWidth: 1, borderRadius: metrics.radius.control, paddingHorizontal: 13, fontSize: type.rowTitle },
  multiline: { minHeight: 180, paddingTop: 12 },
  segmented: { flexDirection: "row", borderWidth: 1, borderRadius: metrics.radius.control, overflow: "hidden" },
  segment: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  state: { flex: 1, minHeight: 180, paddingHorizontal: metrics.padX, paddingVertical: 30, alignItems: "center", justifyContent: "center", gap: 9 },
});
