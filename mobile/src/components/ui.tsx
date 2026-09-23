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

import { GlassGroup, GlassSurface } from "@/features/nav/glass";
import { useI18n } from "@/lib/i18n";
import { isLiquidGlass } from "@/lib/platform";
import { fonts, metrics, type, usePalette } from "@/theme";

// Zekra's mobile design — the desktop app's native language (desktop/src/
// renderer/theme.css) on a phone. A screen is [status-bar spacer][header]
// [content][footer] on the plain ground. Content sits in grouped cards: 16pt
// in from the edges, 12pt radius, the raised surface with a hairline outline
// (the desktop's settings groups, iOS's inset-grouped lists). Section labels
// are sentence case in the UI face; selection is the violet accent's tint;
// violet is also the one primary action per screen. No rails, no hatch, no
// mono labels (mono is for code and secrets only).

// ─── Text ───────────────────────────────────────────────────────────────────

type Variant = "bigHeader" | "title" | "rowTitle" | "body" | "meta" | "micro" | "latin" | "mono";

/**
 * Text with the design's rules baked in: Inter for English, Lusail for
 * Arabic; Arabic is never letter-spaced and never set in mono. `micro` is a
 * section label; `latin` is one that stays left-to-right in both languages.
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
    bigHeader: { fontFamily: fonts.semibold, fontSize: type.bigHeader, color: p.ink, lineHeight: Math.round(type.bigHeader * (isRtl ? 1.45 : 1.3)) },
    title: { fontFamily: fonts.semibold, fontSize: type.title, color: p.ink, lineHeight: Math.round(type.title * (isRtl ? 1.6 : 1.45)) },
    rowTitle: { fontFamily: fonts.medium, fontSize: type.rowTitle, color: p.ink, lineHeight: Math.round(type.rowTitle * (isRtl ? 1.7 : 1.4)) },
    body: { fontFamily: fonts.regular, fontSize: type.body, color: p.body, lineHeight: Math.round(type.body * (isRtl ? 1.8 : 1.45)) },
    meta: { fontFamily: fonts.regular, fontSize: type.meta, color: p.muted, lineHeight: Math.round(type.meta * (isRtl ? 1.7 : 1.5)) },
    // A section label: sentence case, the UI face, muted (desktop .grid-micro).
    micro: { fontFamily: fonts.semibold, fontSize: isRtl ? type.microAr : type.micro, color: p.muted },
    latin: { fontFamily: fonts.semibold, fontSize: type.micro, color: p.muted, writingDirection: "ltr" },
    mono: { fontFamily: fonts.mono, fontSize: type.meta, color: p.muted },
  };
  return <Text {...rest} style={[base[variant], { writingDirection: isRtl ? "rtl" : "ltr" }, variant === "latin" ? { writingDirection: "ltr" } : null, color ? { color } : null, style]} />;
}

/** A left-to-right isolate (U+2066 … U+2069): keeps a Latin run (a namespace,
 *  "+3", an email) in order inside an Arabic paragraph. Android ignores
 *  writingDirection on nested runs, so the isolate is what actually works. */
export const ltr = (s: string) => "\u2066" + s + "\u2069";

// ─── Groups ─────────────────────────────────────────────────────────────────

/** A grouped card: 16pt in from the screen edges, 12pt radius, the raised
 *  surface with a hairline outline, 16/14 padding, 12 gap (desktop's settings
 *  group). Pressable when given onPress / onLongPress. */
export function Row({ children, style, onPress, onLongPress, accessibilityLabel }: {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  const card = (pressed: boolean): ViewStyle => ({
    marginHorizontal: metrics.inset,
    borderRadius: metrics.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.hairline,
    backgroundColor: pressed ? p.selected : p.raised,
    paddingHorizontal: metrics.padX,
    paddingVertical: metrics.padY,
    gap: 12,
    overflow: "hidden",
  });
  if (!onPress && !onLongPress) return <View style={[card(false), style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: p.selected }}
      style={({ pressed }) => [card(pressed), style]}
    >
      {children}
    </Pressable>
  );
}

/**
 * One cell of a grouped list rendered by a FlatList (notes, brains): the
 * first cell carries the card's top corners, the last its bottom corners,
 * and cells in between are split by an inset hairline — so a virtualised
 * list still reads as one grouped card, as in the desktop's lists.
 */
export function Cell({ first, last, children, style, dividerInset = metrics.padX }: {
  first?: boolean;
  last?: boolean;
  children: ReactNode;
  style?: ViewStyle;
  /** Where the divider starts (align it with the cell's text). */
  dividerInset?: number;
}) {
  const p = usePalette();
  const r = metrics.radius.card;
  return (
    <View
      style={[
        {
          marginHorizontal: metrics.inset,
          backgroundColor: p.raised,
          borderColor: p.hairline,
          borderStartWidth: StyleSheet.hairlineWidth,
          borderEndWidth: StyleSheet.hairlineWidth,
          overflow: "hidden",
        },
        first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopStartRadius: r, borderTopEndRadius: r },
        last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomStartRadius: r, borderBottomEndRadius: r },
        style,
      ]}
    >
      {children}
      {!last ? <View pointerEvents="none" style={{ position: "absolute", bottom: 0, end: 0, start: dividerInset, height: StyleSheet.hairlineWidth, backgroundColor: p.hairline }} /> : null}
    </View>
  );
}

/** Groups stacked 20pt apart. `inset` adds the same space above the first. */
export function Rows({ children, inset, style }: { children: ReactNode; inset?: boolean; style?: ViewStyle }) {
  return <View style={[{ gap: metrics.gap }, inset && { paddingTop: metrics.gap - 8 }, style]}>{children}</View>;
}

/** A section label above a group, aligned with the card's content. */
export function SectionLabel({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: metrics.inset + 4, marginBottom: -12 }}>
      <AppText variant="micro" style={{ flex: 1 }} numberOfLines={1}>{children}</AppText>
      {trailing}
    </View>
  );
}

/** A label inside a card: sentence case, the UI face, muted. */
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

/** A 44pt round bar button: borderless, a soft fill while pressed; icons at
 *  20 / 1.6 stroke / muted. `dot` draws the unread dot.
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
          {dot ? <View style={[styles.dot, { top: 8, end: 8, backgroundColor: p.action }]} /> : null}
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
          : { backgroundColor: pressed ? p.field : "transparent", opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {children}
      {dot ? <View style={[styles.dot, { backgroundColor: p.action }]} /> : null}
    </Pressable>
  );
}

/** Large title for tab roots (iOS large title / the desktop's window title):
 *  32/600, an optional muted count after it, trailing bar buttons. */
export function Header({ title, subtitle, eyebrow, count, actions }: {
  title: string;
  /** A muted line under the title (the desktop's window subtitle). */
  subtitle?: string;
  /** Legacy: a micro-label above the title. The reference has none; kept for callers. */
  eyebrow?: string;
  count?: number | string;
  actions?: ReactNode;
}) {
  const p = usePalette();
  const { isRtl } = useI18n();
  return (
    <View style={[styles.header, { backgroundColor: p.bg }]}>
      <View style={styles.headerTitle}>
        {eyebrow ? <AppText variant="micro" numberOfLines={1} style={{ marginBottom: 2 }}>{eyebrow}</AppText> : null}
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {/* Arabic is never letter-spaced — spacing it also makes the title
              measure wider than it renders and truncates. */}
          <AppText variant="bigHeader" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ letterSpacing: isRtl ? 0 : -0.5, flexShrink: 1 }}>
            {title}
          </AppText>
          {count !== undefined && count !== "" ? (
            <AppText style={{ fontFamily: fonts.regular, fontSize: 17, color: p.muted, marginStart: 8, marginTop: isRtl ? 12 : 10, writingDirection: "ltr" }}>
              {String(count)}
            </AppText>
          ) : null}
        </View>
        {subtitle ? <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: p.muted, marginTop: -2 }}>{subtitle}</AppText> : null}
      </View>
      {actions ? (
        // iOS 26+: the glass buttons share one container so neighbours blend.
        isLiquidGlass() ? <GlassGroup style={styles.headerEnd}>{actions}</GlassGroup> : <View style={styles.headerEnd}>{actions}</View>
      ) : null}
    </View>
  );
}

/** A screen: safe-area spacer, header, content on the plain ground, optional
 *  footer. Not scrolling by default (lists bring their own FlatList). */
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
        {scroll ? (
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
            contentContainerStyle={[{ paddingTop: 4, paddingBottom: metrics.gap + (footer ? 0 : 8) }, contentStyle]}
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
    </View>
  );
}

/** Bottom action bar: the raised surface, hairline top. */
export function ActionBar({ children }: { children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.hairline, backgroundColor: p.raised, paddingTop: 12, paddingHorizontal: metrics.inset, paddingBottom: Math.max(insets.bottom, 12) + 4, gap: 9 }}>
      {children}
    </View>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────

/** Primary: 46 min height, violet ground, 16/600 label, optional leading icon
 *  (18, 1.6, onAction). One per screen. */
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
      <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16.5, lineHeight: 24 }} color={p.onAction}>{label}</AppText>
    </Pressable>
  );
}

/** Secondary: 46 min, the soft field fill, no outline, 16/500 label.
 *  `selected` is the accent-tint choice state; `tone="danger"` the destructive one. */
export function SecondaryButton({ label, loading, icon, selected, tone, style, disabled, ...props }: PressableProps & {
  label: string;
  loading?: boolean;
  icon?: ReactNode;
  selected?: boolean;
  tone?: "quiet" | "danger";
}) {
  const p = usePalette();
  const danger = tone === "danger";
  const text = danger ? p.danger : selected ? p.action : p.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        {
          backgroundColor: selected ? p.tint : danger ? (state.pressed ? `${p.danger}2E` : `${p.danger}1A`) : state.pressed ? p.selected : p.field,
          opacity: disabled ? 0.45 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={text} size="small" /> : icon}
      <AppText numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 }} color={text}>{label}</AppText>
    </Pressable>
  );
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

/**
 * Field: a muted label above; a 44pt filled box (the desktop's .field — no
 * outline until focused, then the accent), 10 radius, optional leading icon
 * (17, 1.6, muted) and trailing slot; 16 text. No textAlign — natural
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
    <View style={{ gap: 7 }}>
      {label ? <AppText style={{ fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 20, color: p.muted }}>{label}</AppText> : null}
      <View
        style={[
          styles.fieldBox,
          {
            minHeight: multiline ? 96 : metrics.input,
            alignItems: multiline ? "flex-start" : "center",
            paddingVertical: multiline ? 4 : 0,
            borderColor: focused ? p.action : "transparent",
            backgroundColor: editable ? p.field : p.raised,
          },
        ]}
      >
        {icon ? <View style={multiline ? { paddingTop: 12 } : null}>{icon}</View> : null}
        <TextInput
          placeholderTextColor={p.muted}
          selectionColor={p.action}
          cursorColor={p.action}
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
              fontFamily: fonts.regular,
              fontSize: 16,
              lineHeight: multiline ? Math.round(16 * 1.65) : undefined,
              color: editable ? p.ink : p.muted,
              writingDirection: forceLtr ? "ltr" : isRtl ? "rtl" : "ltr",
            },
            style,
          ]}
          {...props}
        />
        {trailing}
      </View>
      {hint ? <AppText style={{ fontFamily: fonts.light, fontSize: 13, lineHeight: 21, color: p.muted }}>{hint}</AppText> : null}
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
                { borderColor: filled || current ? p.action : "transparent", backgroundColor: filled ? p.tint : p.field },
              ]}
            >
              {filled ? (
                <AppText style={{ fontFamily: fonts.mono, fontSize: 23, lineHeight: 29, color: p.ink, writingDirection: "ltr" }}>{digits[i]}</AppText>
              ) : current ? (
                <View style={{ width: 2, height: 24, backgroundColor: p.action }} />
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
 * A segmented control (theme, Edit/Preview, a brain's sections): a soft
 * track with the chosen segment raised on it, as on iOS and the desktop.
 */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <View style={[styles.track, { backgroundColor: p.field }]} accessibilityRole="radiogroup">
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
              active ? [styles.segmentOn, { backgroundColor: p.raised }] : { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <AppText numberOfLines={1} style={{ fontFamily: active ? fonts.semibold : fonts.medium, fontSize: 14.5, lineHeight: 21, color: active ? p.ink : p.muted }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A centred state: a spinner while loading, title, optional body.
 *  Prefer a Row with kit's AwaitNote inside lists; this is for whole screens. */
export function StatePanel({ title, body, loading, action }: { title: string; body?: string; loading?: boolean; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={p.muted} /> : null}
      <AppText style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 28, color: p.ink, textAlign: "center" }}>{title}</AppText>
      {body ? <AppText style={{ fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: p.muted, textAlign: "center", maxWidth: 320 }}>{body}</AppText> : null}
      {action ? <View style={{ alignSelf: "stretch", marginTop: 6 }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 6, paddingBottom: 10, paddingHorizontal: metrics.inset + 4, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { flex: 1 },
  headerEnd: { flexDirection: "row", gap: 9, alignItems: "center" },
  iconBtn: { width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 9, end: 10, width: 7, height: 7, borderRadius: 3.5 },
  button: { minHeight: metrics.button, borderRadius: metrics.radius.control, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  fieldBox: { borderWidth: 1, borderRadius: metrics.radius.control, paddingHorizontal: 13, flexDirection: "row", gap: 10 },
  codeBox: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: metrics.radius.control, alignItems: "center", justifyContent: "center" },
  codeInput: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, opacity: 0.02, color: "transparent" },
  track: { flexDirection: "row", padding: 2, borderRadius: metrics.radius.control, gap: 2 },
  segment: { flex: 1, minHeight: 34, borderRadius: metrics.radius.control - 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  segmentOn: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  state: { flex: 1, minHeight: 200, paddingHorizontal: metrics.padX + 8, paddingVertical: 32, alignItems: "center", justifyContent: "center", gap: 10 },
});
