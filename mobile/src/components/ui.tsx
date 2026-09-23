import { useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ScrollViewProps,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";

import { GlassGroup, GlassSurface } from "@/features/nav/glass";
import { useI18n } from "@/lib/i18n";
import { isLiquidGlass } from "@/lib/platform";
import { fonts, metrics, type, usePalette } from "@/theme";

// The house mobile design, ported from fadymondy.com/mobile/src/components/ui.tsx
// (spec: fadymondy.com/.setup/design/mobile/SCREENS.md §1). A screen is
// [status-bar spacer][header][hatch-ground content][footer] with two 1px rails
// painted over everything, 20px in from each edge. Content blocks are
// full-bleed rows with a hairline top and bottom and 28px padding; the 16px
// gaps between them show the −45° hatch. Radii: controls 8, chips 6, sheets 14.
// Zekra's violet is the one primary action per screen (the reference's
// orange); gold is selection, focus and the active tab.

// ─── Text ───────────────────────────────────────────────────────────────────

type Variant = "bigHeader" | "title" | "rowTitle" | "body" | "meta" | "micro" | "latin" | "mono";

/**
 * Text with the design's rules baked in (§ Type): Lusail for Arabic and Latin,
 * weights 300/400/500 only; Arabic is never letter-spaced and never set in
 * mono, so `micro` switches shape by locale. `latin` is a micro-label that
 * stays Latin mono in both languages.
 *
 * The paragraph direction follows the language by default — iOS otherwise
 * resolves "natural" alignment from the device language, putting Arabic on the
 * left edge. It is applied BEFORE the caller's style, so a caller can still
 * force an LTR run (secret values, mono subtitles, emails).
 */
export function AppText({ variant = "body", color, style, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const base: Record<Variant, TextStyle> = {
    bigHeader: { fontFamily: fonts.semibold, fontSize: type.bigHeader, color: p.ink, lineHeight: type.bigHeader * 1.45 },
    title: { fontFamily: fonts.semibold, fontSize: type.title, color: p.ink, lineHeight: type.title * 1.55 },
    rowTitle: { fontFamily: fonts.medium, fontSize: type.rowTitle, color: p.ink, lineHeight: type.rowTitle * (isRtl ? 1.8 : 1.55) },
    body: { fontFamily: fonts.light, fontSize: type.body, color: p.body, lineHeight: type.body * (isRtl ? 2 : 1.7) },
    meta: { fontFamily: fonts.regular, fontSize: type.meta, color: p.muted, lineHeight: type.meta * 1.7 },
    micro: isRtl
      ? { fontFamily: fonts.medium, fontSize: type.microAr, color: p.muted }
      : { fontFamily: fonts.monoMedium, fontSize: type.micro, color: p.muted, letterSpacing: type.micro * 0.2, textTransform: "uppercase" },
    latin: {
      fontFamily: fonts.monoMedium,
      fontSize: type.micro,
      color: p.muted,
      letterSpacing: type.micro * 0.2,
      textTransform: "uppercase",
      writingDirection: "ltr",
    },
    mono: { fontFamily: fonts.mono, fontSize: type.meta, color: p.muted },
  };
  return <Text {...rest} style={[base[variant], { writingDirection: isRtl ? "rtl" : "ltr" }, variant === "latin" ? { writingDirection: "ltr" } : null, color ? { color } : null, style]} />;
}

/** A left-to-right isolate (U+2066 … U+2069): keeps a Latin run (a namespace,
 *  "+3", an email) in order inside an Arabic paragraph. Android ignores
 *  writingDirection on nested runs, so the isolate is what actually works. */
export const ltr = (s: string) => "\u2066" + s + "\u2069";

// ─── Grid ───────────────────────────────────────────────────────────────────

/** Two full-height 1px rails, 20px in from each edge, painted above content (§1.3). */
export function Rails() {
  const p = usePalette();
  return (
    <>
      <View pointerEvents="none" style={[styles.rail, { start: metrics.rail, backgroundColor: p.line }]} />
      <View pointerEvents="none" style={[styles.rail, { end: metrics.rail, backgroundColor: p.line }]} />
    </>
  );
}

/** The −45° hatch ground: a 1px `soft` line every 8px (§1.4). It is the ground
 *  of the content area, so it shows only in the gaps between rows. */
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

/** A full-bleed content row (§1.7): hairline top and bottom, 16/28 padding, 12 gap. */
export function Row({ children, style, onPress, onLongPress, accessibilityLabel }: {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}) {
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
  if (!onPress && !onLongPress) return body;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: p.soft }}
      style={({ pressed }) => ({ opacity: pressed ? 0.86 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/** Rows stacked 16px apart; the hatch shows in the gaps. `inset` is the
 *  reference's variant A (search): rows start 8px in from each edge, 16px
 *  below the header. */
export function Rows({ children, inset, style }: { children: ReactNode; inset?: boolean; style?: ViewStyle }) {
  return <View style={[{ gap: metrics.gap }, inset && { paddingTop: metrics.gap, paddingHorizontal: 8 }, style]}>{children}</View>;
}

/** A row micro-label (§1.7): Latin mono uppercase, Arabic 11.5/500. */
export function MicroLabel({ children, trailing }: { children: string; trailing?: ReactNode }) {
  if (!trailing) return <AppText variant="micro">{children}</AppText>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <AppText variant="micro" style={{ flex: 1 }} numberOfLines={1}>{children}</AppText>
      {trailing}
    </View>
  );
}

// ─── Chrome ─────────────────────────────────────────────────────────────────

/** 44px square, 1px border, transparent ground, 8px radius (§1.5). Icons go in
 *  at 20 / 1.6 stroke / muted. `dot` draws the gold unread dot.
 *
 *  iOS 26+ (isLiquidGlass): the same button as a 44px Liquid Glass circle —
 *  clear glass, or violet-tinted glass for `tone="action"` — like the system's
 *  own bar buttons. Same props, same hit area. */
export function IconButton({ children, onPress, label, disabled, dot, tone }: {
  children: ReactNode;
  onPress?: () => void;
  label: string;
  disabled?: boolean;
  dot?: boolean;
  /** "action": a filled violet square — the screen's one primary action. */
  tone?: "action";
}) {
  const p = usePalette();
  const action = tone === "action";
  if (isLiquidGlass()) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        onPress={onPress}
        disabled={disabled}
        hitSlop={4}
        style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.82 : 1 })}
      >
        <GlassSurface
          interactive={!disabled}
          tint={action ? p.action : undefined}
          style={{ width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: "center", justifyContent: "center" }}
        >
          {children}
          {dot ? <View style={[styles.dot, { top: 8, end: 8, backgroundColor: p.gold }]} /> : null}
        </GlassSurface>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconBtn,
        action
          ? { borderColor: p.action, backgroundColor: p.action, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }
          : { borderColor: p.line, backgroundColor: pressed ? p.card : "transparent", opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {children}
      {dot ? <View style={[styles.dot, { backgroundColor: p.gold }]} /> : null}
    </Pressable>
  );
}

/** Large header for tab roots (§1.5): 27/600 title, optional mono superscript
 *  count 7px after it, trailing icon buttons 9 apart, hairline bottom. */
export function Header({ title, eyebrow, count, actions }: {
  title: string;
  /** Legacy: a micro-label above the title. The reference has none; kept for callers. */
  eyebrow?: string;
  count?: number | string;
  actions?: ReactNode;
}) {
  const p = usePalette();
  const { isRtl } = useI18n();
  return (
    <View style={[styles.header, { borderBottomColor: p.line, backgroundColor: p.bg }]}>
      <View style={styles.headerTitle}>
        {eyebrow ? <AppText variant="micro" numberOfLines={1} style={{ marginBottom: 2 }}>{eyebrow}</AppText> : null}
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {/* Arabic is never letter-spaced — spacing it also makes the title
              measure wider than it renders and truncates. */}
          <AppText variant="bigHeader" numberOfLines={1} style={{ letterSpacing: isRtl ? 0 : -0.27, flexShrink: 1 }}>
            {title}
          </AppText>
          {count !== undefined && count !== "" ? (
            <AppText style={{ fontFamily: fonts.mono, fontSize: 12, color: p.muted, marginStart: 7, marginTop: 4, writingDirection: "ltr" }}>
              {String(count)}
            </AppText>
          ) : null}
        </View>
      </View>
      {actions ? (
        // iOS 26+: the glass buttons share one container so neighbours blend.
        isLiquidGlass() ? <GlassGroup style={styles.headerEnd}>{actions}</GlassGroup> : <View style={styles.headerEnd}>{actions}</View>
      ) : null}
    </View>
  );
}

/** A screen (§1.2): safe-area spacer, header, content on the hatch ground,
 *  optional footer, rails over all. Not scrolling by default (lists bring
 *  their own FlatList). */
export function Screen({ header, footer, children, scroll = false, refreshControl, contentStyle }: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: ScrollViewProps["refreshControl"];
  /** Extra style for the scroll content container. */
  contentStyle?: ViewStyle;
}) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, direction: isRtl ? "rtl" : "ltr" }}>
      <View style={{ height: insets.top, backgroundColor: p.bg }} />
      {header}
      <View style={{ flex: 1 }}>
        <HatchFill />
        {scroll ? (
          <ScrollView
            contentContainerStyle={[{ paddingBottom: metrics.gap + (footer ? 0 : 8) }, contentStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={refreshControl}
          >
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

/** Bottom action bar (§1.13): card ground, hairline top, 12/28 padding. */
export function ActionBar({ children }: { children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: p.line, backgroundColor: p.card, paddingTop: 12, paddingHorizontal: metrics.padX, paddingBottom: Math.max(insets.bottom, 12) + 4, gap: 9 }}>
      {children}
    </View>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────

/** Primary (§1.9): 46 min height, 8 radius, violet ground, 15/600 label,
 *  optional leading icon (18, 1.6, onAction). One per screen. */
export function PrimaryButton({ label, loading, icon, style, disabled, ...props }: PressableProps & { label: string; loading?: boolean; icon?: ReactNode }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        { backgroundColor: p.action, opacity: disabled ? 0.45 : state.pressed ? 0.86 : 1 },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={p.onAction} size="small" /> : icon}
      <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 }} color={p.onAction}>{label}</AppText>
    </Pressable>
  );
}

/** Secondary (§1.9): 46 min, 1px line border, card ground, 14.5/400 label.
 *  `selected` is the gold choice state; `tone="danger"` the destructive one. */
export function SecondaryButton({ label, loading, icon, selected, tone, style, disabled, ...props }: PressableProps & {
  label: string;
  loading?: boolean;
  icon?: ReactNode;
  selected?: boolean;
  tone?: "quiet" | "danger";
}) {
  const p = usePalette();
  const danger = tone === "danger";
  const text = danger ? p.danger : selected ? p.gold : p.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        {
          borderWidth: 1,
          borderColor: selected ? p.gold : danger ? `${p.danger}66` : p.line,
          backgroundColor: selected ? `${p.gold}1A` : danger ? (state.pressed ? `${p.danger}22` : `${p.danger}0F`) : state.pressed ? p.soft : p.card,
          opacity: disabled ? 0.45 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={text} size="small" /> : icon}
      <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22 }} color={text}>{label}</AppText>
    </Pressable>
  );
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

/**
 * Field (§1.10): 11/500 muted label 8px above; a 46px card box with a 1px line
 * border (gold while focused), 8 radius, 13 padding, optional leading icon
 * (17, 1.6, muted) and trailing slot; 14.5 text. No textAlign — natural
 * alignment follows the direction; `ltr` pins emails, codes and URLs
 * left-to-right in both languages. `style` applies to the TextInput.
 */
export function Field({ label, hint, icon, trailing, ltr: forceLtr, multiline, style, onFocus, onBlur, editable = true, ...props }: TextInputProps & {
  label?: string;
  hint?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  ltr?: boolean;
}) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      {label ? <AppText style={{ fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, color: p.muted }}>{label}</AppText> : null}
      <View
        style={[
          styles.fieldBox,
          {
            minHeight: multiline ? 96 : metrics.input,
            alignItems: multiline ? "flex-start" : "center",
            paddingVertical: multiline ? 4 : 0,
            borderColor: focused ? p.gold : p.line,
            backgroundColor: editable ? p.card : p.bg,
          },
        ]}
      >
        {icon ? <View style={multiline ? { paddingTop: 12 } : null}>{icon}</View> : null}
        <TextInput
          placeholderTextColor={p.muted}
          selectionColor={p.gold}
          cursorColor={p.gold}
          multiline={multiline}
          editable={editable}
          textAlignVertical={multiline ? "top" : "center"}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[
            {
              flex: 1,
              minHeight: multiline ? 88 : metrics.input - 2,
              paddingVertical: multiline ? 8 : 10,
              fontFamily: multiline ? fonts.light : fonts.regular,
              fontSize: 14.5,
              lineHeight: multiline ? 14.5 * 1.8 : undefined,
              color: editable ? p.ink : p.muted,
              writingDirection: forceLtr ? "ltr" : isRtl ? "rtl" : "ltr",
            },
            style,
          ]}
          {...props}
        />
        {trailing}
      </View>
      {hint ? <AppText style={{ fontFamily: fonts.light, fontSize: 11.5, lineHeight: 19, color: p.muted }}>{hint}</AppText> : null}
    </View>
  );
}

/**
 * Six-box code entry (§1.18): mono 22 digits, filled boxes gold, the current
 * box shows a gold caret. Always left-to-right. One hidden TextInput takes the
 * keyboard (and the OS one-time-code autofill).
 */
export function CodeField({ value, onChangeText, length = 6, autoFocus, onComplete, label }: {
  value: string;
  onChangeText: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
  onComplete?: (v: string) => void;
  label?: string;
}) {
  const p = usePalette();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(!!autoFocus);
  const digits = value.split("");
  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityLabel={label} style={{ direction: "ltr" }}>
      <View style={{ flexDirection: "row", gap: 9 }}>
        {Array.from({ length }, (_, i) => {
          const filled = i < digits.length;
          const current = focused && i === Math.min(digits.length, length - 1) && !filled;
          return (
            <View
              key={i}
              style={[
                styles.codeBox,
                { borderColor: filled ? p.gold : p.line, backgroundColor: filled ? `${p.gold}14` : p.card },
              ]}
            >
              {filled ? (
                <AppText style={{ fontFamily: fonts.mono, fontSize: 22, lineHeight: 28, color: p.ink, writingDirection: "ltr" }}>{digits[i]}</AppText>
              ) : current ? (
                <View style={{ width: 2, height: 24, backgroundColor: p.gold }} />
              ) : null}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => {
          const clean = v.replace(/\D/g, "").slice(0, length);
          onChangeText(clean);
          if (clean.length === length) onComplete?.(clean);
        }}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        caretHidden
        style={styles.codeInput}
        accessibilityLabel={label}
      />
    </Pressable>
  );
}

/**
 * A choice group (theme, language, Edit/Preview). The reference draws choices
 * as equal-width secondary buttons with the gold selected state (Account →
 * Settings), not a filled segment — so this does too.
 */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              {
                borderColor: active ? p.gold : p.line,
                backgroundColor: active ? `${p.gold}1A` : pressed ? p.soft : p.card,
              },
            ]}
          >
            <AppText numberOfLines={1} style={{ fontFamily: active ? fonts.medium : fonts.regular, fontSize: 13.5, lineHeight: 20, color: active ? p.gold : p.body }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A centred state: spinner or a 7px gold square, title, optional body.
 *  Prefer a Row with kit's AwaitNote inside lists; this is for whole screens. */
export function StatePanel({ title, body, loading, action }: { title: string; body?: string; loading?: boolean; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={p.gold} /> : <View style={{ width: 7, height: 7, backgroundColor: p.gold }} />}
      <AppText style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 26, color: p.ink, textAlign: "center" }}>{title}</AppText>
      {body ? <AppText style={{ fontFamily: fonts.light, fontSize: 13.5, lineHeight: 23, color: p.muted, textAlign: "center", maxWidth: 320 }}>{body}</AppText> : null}
      {action ? <View style={{ alignSelf: "stretch", marginTop: 6 }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: "absolute", top: 0, bottom: 0, width: 1, zIndex: 5 },
  header: { paddingTop: 6, paddingBottom: 14, paddingHorizontal: metrics.padX, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { flex: 1 },
  headerEnd: { flexDirection: "row", gap: 9, alignItems: "center" },
  iconBtn: { width: metrics.touch, height: metrics.touch, borderWidth: 1, borderRadius: metrics.radius.control, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 9, end: 10, width: 7, height: 7, borderRadius: 3.5 },
  button: { minHeight: metrics.button, borderRadius: metrics.radius.control, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  fieldBox: { borderWidth: 1, borderRadius: metrics.radius.control, paddingHorizontal: 13, flexDirection: "row", gap: 10 },
  codeBox: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: metrics.radius.control, alignItems: "center", justifyContent: "center" },
  codeInput: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, opacity: 0.02, color: "transparent" },
  segment: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: metrics.radius.control, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  state: { flex: 1, minHeight: 200, paddingHorizontal: metrics.padX + 8, paddingVertical: 32, alignItems: "center", justifyContent: "center", gap: 10 },
});
