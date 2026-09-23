import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { AppText, IconButton, Row } from "@/components/ui";
import { GlassGroup, GlassSurface } from "@/features/nav/glass";
import { useI18n } from "@/lib/i18n";
import { isLiquidGlass } from "@/lib/platform";
import { fonts, metrics, usePalette } from "@/theme";

// Building blocks ported from fadymondy.com/mobile/src/components/{blocks,
// admin-kit,content-state}.tsx (SCREENS.md §1.6–§1.16), on Zekra's palette:
// violet `action` where that app uses orange, gold for selection and focus.

// ─── Direction ──────────────────────────────────────────────────────────────

/** Back points toward the reading start, forward away from it. */
export function useChevrons() {
  const { isRtl } = useI18n();
  return {
    Back: isRtl ? ChevronRight : ChevronLeft,
    Forward: isRtl ? ChevronLeft : ChevronRight,
    BackArrow: isRtl ? ArrowRight : ArrowLeft,
    ForwardArrow: isRtl ? ArrowLeft : ArrowRight,
  };
}

export function ForwardChevron({ size = 18, color }: { size?: number; color?: string }) {
  const p = usePalette();
  const { Forward } = useChevrons();
  return <Forward size={size} color={color ?? p.muted} strokeWidth={1.6} />;
}

// ─── Headers ────────────────────────────────────────────────────────────────

/** Header for pushed screens (§1.6): back at the start edge · title (+ mono
 *  subtitle) · optional trailing actions at the end edge.
 *
 *  iOS 26+ (isLiquidGlass): the back and trailing buttons are Liquid Glass
 *  circles (via IconButton) and the trailing ones share a glass container, the
 *  way the system groups bar buttons; the bar itself drops its hairline. */
export function StackHeader({ title, subtitle, trailing, onBack, leading }: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onBack?: () => void;
  /** Rendered between the back button and the title (an avatar, a tile). */
  leading?: ReactNode;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const { Back } = useChevrons();
  const glass = isLiquidGlass();
  return (
    <View style={[styles.stackHeader, { borderBottomColor: p.line, backgroundColor: p.bg }, glass && { borderBottomWidth: 0 }]}>
      <IconButton label={t("kit.back")} onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/brains")))}>
        <Back size={20} color={p.muted} strokeWidth={1.6} />
      </IconButton>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, color: p.ink }}>{title}</AppText>
        {subtitle ? (
          <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: p.muted, writingDirection: "ltr" }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? (glass ? <GlassGroup style={styles.trailing}>{trailing}</GlassGroup> : <View style={styles.trailing}>{trailing}</View>) : null}
    </View>
  );
}

// ─── Rows and tiles ─────────────────────────────────────────────────────────

/** A list item inside a Row: 56 min height, `soft` divider except on the last. */
export function ListItem({ leading, children, trailing, last, onPress, onLongPress, alignTop, padV = 14 }: {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  last?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  alignTop?: boolean;
  padV?: number;
}) {
  const p = usePalette();
  const body = (
    <View style={[styles.item, { paddingVertical: padV, alignItems: alignTop ? "flex-start" : "center" }, !last && { borderBottomWidth: 1, borderBottomColor: p.soft }]}>
      {leading}
      <View style={{ flex: 1, gap: 3 }}>{children}</View>
      {trailing}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} android_ripple={{ color: p.soft }}>
      {body}
    </Pressable>
  );
}

/** Square icon tile (§1.11). `tint` colours border and ground (10%). */
export function Tile({ size = 38, radius = 8, ground = "card", children, gold, tint }: {
  size?: number;
  radius?: number;
  ground?: "card" | "soft" | "bg";
  children?: ReactNode;
  gold?: boolean;
  tint?: string;
}) {
  const p = usePalette();
  const accent = tint ?? (gold ? p.gold : undefined);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: accent ?? p.line,
        backgroundColor: accent ? `${accent}1A` : p[ground],
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

export type ChipTone = "ok" | "warn" | "danger" | "muted" | "gold" | "action";

/** Small status chip: mono label on a 10% tint of its tone. */
export function Chip({ label, tone = "muted" }: { label: string; tone?: ChipTone }) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const color = tone === "muted" ? p.muted : p[tone];
  // JetBrains Mono has no Arabic; Arabic labels use Lusail, never letter-spaced.
  const face = isRtl ? { fontFamily: fonts.medium, fontSize: 11.5 } : { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.4 };
  return (
    <View style={[styles.chip, { borderColor: `${color}66`, backgroundColor: `${color}14` }]}>
      <AppText style={[face, { color }]}>{label}</AppText>
    </View>
  );
}

/** Segmented filter strip (§1.11): gold when selected. Scrolls if it overflows. */
export function FilterStrip<T extends string>({ options, value, onChange, inset = true }: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  inset?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={[styles.strip, inset && { paddingHorizontal: metrics.padX }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.filter, { borderColor: on ? p.gold : p.line, backgroundColor: on ? `${p.gold}1A` : p.card }]}
          >
            <AppText style={{ fontFamily: fonts.regular, fontSize: 13, color: on ? p.gold : p.muted }}>{o.label}</AppText>
            {o.count !== undefined ? (
              <AppText style={{ fontFamily: fonts.mono, fontSize: 10.5, color: on ? p.gold : p.muted }}>{o.count}</AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Awaiting content" note: 7px gold square + muted line. */
export function AwaitNote({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
      <View style={{ width: 7, height: 7, backgroundColor: p.gold }} />
      <AppText style={{ fontFamily: fonts.regular, fontSize: 12.5, color: p.muted, flexShrink: 1 }}>{text}</AppText>
    </View>
  );
}

/** Mono meta items separated by 3px dots. */
export function Meta({ items }: { items: (string | false | null | undefined)[] }) {
  const p = usePalette();
  const shown = items.filter(Boolean) as string[];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {shown.map((m, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {i > 0 && <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: p.line }} />}
          <AppText style={{ fontFamily: fonts.mono, fontSize: 11, color: p.muted }}>{m}</AppText>
        </View>
      ))}
    </View>
  );
}

export function TextButton({ label, onPress, muted, tone }: { label: string; onPress?: () => void; muted?: boolean; tone?: "danger" | "action" }) {
  const p = usePalette();
  const color = tone ? p[tone] : muted ? p.muted : p.gold;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}>
      <AppText style={{ fontFamily: fonts.regular, fontSize: 13.5, color }}>{label}</AppText>
    </Pressable>
  );
}

export function ErrorLine({ text }: { text: string }) {
  const p = usePalette();
  return <AppText style={{ fontFamily: fonts.regular, fontSize: 12.5, color: p.danger }}>{text}</AppText>;
}

/** Grey skeleton bar (§1.15). */
export function Bar({ width, height = 11 }: { width: `${number}%` | number; height?: number }) {
  const p = usePalette();
  return <View style={{ width, height, borderRadius: 3, backgroundColor: p.soft }} />;
}

// ─── Query states ───────────────────────────────────────────────────────────

/** Pull-to-refresh bound to one or more react-query results. */
export function useQueryRefresh(...queries: Pick<UseQueryResult, "refetch">[]) {
  const p = usePalette();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    await Promise.all(queries.map((q) => q.refetch()));
    setPulling(false);
  };
  return <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={p.gold} colors={[p.gold]} progressBackgroundColor={p.card} />;
}

/**
 * Loading skeleton / error with retry / empty note for a react-query result.
 * Returns null once there is data to show and nothing to say about it.
 */
export function QueryStatus({ q, empty, emptyText, lines = 4 }: {
  q: Pick<UseQueryResult, "isPending" | "error" | "refetch">;
  empty?: boolean;
  emptyText?: string;
  lines?: number;
}) {
  const { t } = useI18n();
  if (q.isPending) {
    return (
      <Row>
        {Array.from({ length: lines }, (_, i) => (
          <View key={i} style={{ gap: 9, paddingVertical: 12 }}>
            <Bar width="70%" height={13} />
            <Bar width="45%" />
          </View>
        ))}
      </Row>
    );
  }
  if (q.error) {
    const offline = (q.error as { status?: number }).status === 0;
    return (
      <Row>
        <ErrorLine text={offline ? t("kit.offline") : q.error.message || t("kit.error")} />
        <TextButton label={t("kit.retry")} onPress={() => void q.refetch()} />
      </Row>
    );
  }
  if (empty) {
    return (
      <Row>
        <AwaitNote text={emptyText ?? t("kit.empty")} />
      </Row>
    );
  }
  return null;
}

// ─── Bottom sheet ───────────────────────────────────────────────────────────

/**
 * A real bottom sheet: slides up over a scrim, drags down to dismiss, closes on
 * scrim tap and hardware back. RN's Modal renders outside the root view, so it
 * re-establishes the layout direction and its own gesture root.
 */
export function BottomSheet({ open, onClose, title, subtitle, children, maxHeight = 0.86 }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Fraction of the window height the sheet may take. */
  maxHeight?: number;
}) {
  const p = usePalette();
  const { isRtl } = useI18n();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const y = useSharedValue(height);
  const scrim = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      y.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      scrim.value = withTiming(1, { duration: 220 });
    } else if (mounted) {
      scrim.value = withTiming(0, { duration: 180 });
      y.value = withTiming(height, { duration: 220, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(setMounted, false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const drag = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      y.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) scheduleOnRN(onClose);
      else y.value = withTiming(0, { duration: 180 });
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  // iOS 26+: a Liquid Glass sheet with the system's rounder corners. The glass
  // is tinted with the card colour so rows stay legible over any content.
  const glass = isLiquidGlass();
  const glassRadius = { borderTopStartRadius: 28, borderTopEndRadius: 28 };

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1, direction: isRtl ? "rtl" : "ltr" }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: metrics.scrim }, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="dismiss" />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: p.card, borderColor: p.line, maxHeight: height * maxHeight, paddingBottom: Math.max(insets.bottom, 12) },
            glass && { backgroundColor: "transparent", borderWidth: 0, ...glassRadius },
            sheetStyle,
          ]}
        >
          {glass ? <GlassSurface pointerEvents="none" tint={`${p.card}C7`} style={[StyleSheet.absoluteFill, glassRadius]} /> : null}
          <GestureDetector gesture={drag}>
            <View style={styles.grabZone}>
              <View style={[styles.grabber, { backgroundColor: p.line }]} />
              {title ? (
                <View style={{ paddingHorizontal: metrics.padX, gap: 3, alignSelf: "stretch" }}>
                  <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, color: p.ink }}>{title}</AppText>
                  {subtitle ? <AppText numberOfLines={1} variant="micro">{subtitle}</AppText> : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A 48px sheet action row. */
export function SheetItem({ icon, label, detail, onPress, tone, disabled, trailing }: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  onPress?: () => void;
  tone?: "danger" | "action" | "gold";
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  const p = usePalette();
  const color = tone ? p[tone] : p.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: p.soft }}
      style={({ pressed }) => [styles.sheetItem, { opacity: disabled ? 0.45 : 1, backgroundColor: pressed ? p.soft : "transparent" }]}
    >
      {icon ? <View style={{ width: 22, alignItems: "center" }}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: 15, color }}>{label}</AppText>
        {detail ? <AppText variant="meta" numberOfLines={1}>{detail}</AppText> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export function SheetDivider({ label }: { label?: string }) {
  const p = usePalette();
  if (label) {
    return (
      <View style={{ paddingHorizontal: metrics.padX, paddingTop: 14, paddingBottom: 6, borderTopWidth: 1, borderTopColor: p.soft }}>
        <AppText variant="micro">{label.toUpperCase()}</AppText>
      </View>
    );
  }
  return <View style={{ height: 1, backgroundColor: p.soft, marginVertical: 4 }} />;
}

// ─── Toast ──────────────────────────────────────────────────────────────────

type ToastMsg = { id: number; text: string; tone?: "ok" | "danger" };
let pushToast: ((m: ToastMsg) => void) | null = null;
let toastSeq = 0;

/** Show a short confirmation ("Copied", "Saved") above the tab bar. */
export function toast(text: string, tone?: "ok" | "danger") {
  pushToast?.({ id: ++toastSeq, text, tone });
}

/** Mount once at the root. */
export function ToastHost() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const o = useSharedValue(0);
  useEffect(() => {
    pushToast = (m) => {
      setMsg(m);
      o.value = withTiming(1, { duration: 160 });
    };
    return () => {
      pushToast = null;
    };
  }, [o]);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => {
      o.value = withTiming(0, { duration: 200 }, (done) => {
        if (done) scheduleOnRN(setMsg, null);
      });
    }, 1800);
    return () => clearTimeout(id);
  }, [msg, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 12 }] }));
  if (!msg) return null;
  const accent = msg.tone === "danger" ? p.danger : msg.tone === "ok" ? p.ok : p.gold;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 86, backgroundColor: p.card, borderColor: p.line }, style]}>
      <View style={{ width: 7, height: 7, backgroundColor: accent }} />
      <AppText style={{ fontFamily: fonts.regular, fontSize: 13.5, color: p.ink }}>{msg.text}</AppText>
    </Animated.View>
  );
}

/** Inline busy indicator in the action colour. */
export function Spinner({ size = "small" as "small" | "large" }) {
  const p = usePalette();
  return <ActivityIndicator size={size} color={p.gold} />;
}

const styles = StyleSheet.create({
  stackHeader: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: metrics.padX, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  trailing: { flexDirection: "row", gap: 8, alignItems: "center" },
  item: { flexDirection: "row", gap: 13, minHeight: 56 },
  chip: { minHeight: 22, paddingHorizontal: 7, borderRadius: metrics.radius.chip, borderWidth: 1, justifyContent: "center", alignSelf: "flex-start" },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 12, paddingBottom: metrics.gap },
  filter: { minHeight: 38, paddingHorizontal: 15, borderRadius: metrics.radius.chip, borderWidth: 1, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 7 },
  sheet: { position: "absolute", start: 0, end: 0, bottom: 0, borderTopStartRadius: metrics.radius.sheet, borderTopEndRadius: metrics.radius.sheet, borderWidth: 1, borderBottomWidth: 0, overflow: "hidden" },
  grabZone: { alignItems: "center", paddingTop: 9, paddingBottom: 10, gap: 12 },
  grabber: { width: 44, height: 4, borderRadius: 2 },
  sheetItem: { minHeight: 48, paddingHorizontal: metrics.padX, flexDirection: "row", alignItems: "center", gap: 14 },
  toast: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 16, minHeight: 40, borderRadius: metrics.radius.control, borderWidth: 1 },
});
