import { X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { toast } from "@/components/kit";
import { AppText } from "@/components/ui";
import type { PushBanner } from "@/features/push/push-core";
import { emitNotify } from "@/features/notify/bus";
import { queueRoute } from "@/features/push/route-queue";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

// Foreground notifications (MH-373). While the app is open the OS shows
// nothing, so a message arriving then is drawn here: a banner under the status
// bar, tap to open what it is about, dismissed after a few seconds.

const VISIBLE_MS = 6000;

let push: ((b: PushBanner) => void) | null = null;

/** Show a foreground message. Falls back to a toast if no host is mounted. */
export function showPushBanner(banner: PushBanner): void {
  if (push) push(banner);
  else toast(banner.body ? `${banner.title} — ${banner.body}` : banner.title);
}

/** Mount once at the root, above the navigator (next to ToastHost). */
export function PushBannerHost() {
  const p = usePalette();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [banner, setBanner] = useState<PushBanner | null>(null);
  const shown = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    shown.value = withTiming(0, { duration: 180 }, (done) => {
      if (done) scheduleOnRN(setBanner, null);
    });
  }, [shown]);

  useEffect(() => {
    push = (b) => {
      setBanner(b);
      shown.value = withTiming(1, { duration: 200 });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, VISIBLE_MS);
    };
    return () => {
      push = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hide, shown]);

  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * -16 }] }));
  if (!banner) return null;

  const open = () => {
    hide();
    // The push watcher (push.ts) marks the inbox item read (MH-360).
    if (banner.notificationId) emitNotify({ type: "opened", id: banner.notificationId });
    queueRoute(banner.route);
  };

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 6 }, style]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: p.elevated, borderColor: p.elevatedLine }]}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={banner.body ? `${banner.title}. ${banner.body}` : banner.title}
          accessibilityHint={banner.route ? t("push.bannerHint") : undefined}
          accessibilityLiveRegion="polite"
          style={styles.body}
        >
          <View style={{ width: 7, height: 7, marginTop: 7, backgroundColor: p.gold }} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14.5, color: p.ink }}>{banner.title}</AppText>
            {banner.body ? (
              <AppText numberOfLines={2} style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: p.body }}>{banner.body}</AppText>
            ) : null}
          </View>
        </Pressable>
        <Pressable onPress={hide} accessibilityRole="button" accessibilityLabel={t("push.dismiss")} hitSlop={8} style={styles.close}>
          <X size={16} color={p.muted} strokeWidth={1.8} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", start: 10, end: 10, zIndex: 50 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: metrics.radius.control,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  body: { flex: 1, flexDirection: "row", gap: 10, paddingVertical: 12, paddingStart: 14, paddingEnd: 4 },
  close: { width: 40, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
