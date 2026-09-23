import { router, type Href } from "expo-router";
import { Bell } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { AppText, IconButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

import { badgeLabel } from "./notify-core";
import { useUnreadCount } from "./use-notifications";

/**
 * The header bell (MH-360): a 44px IconButton with the unread count in a gold
 * badge at its top end (99+ past 99), nothing when all is read. Opens the
 * notification center (app/notifications.tsx). Drop it into a Header's
 * `actions` or a StackHeader's `trailing`.
 */
export function NotificationBell() {
  const p = usePalette();
  const { t } = useI18n();
  const { unread } = useUnreadCount();
  const label = badgeLabel(unread);
  return (
    <View>
      <IconButton
        label={label ? t("notify.bellUnread", { count: label }) : t("notify.bell")}
        onPress={() => router.push("/notifications" as Href)}
      >
        <Bell size={20} color={p.muted} strokeWidth={1.6} />
      </IconButton>
      {label ? (
        <View pointerEvents="none" style={[styles.badge, { backgroundColor: p.gold, borderColor: p.bg }]}>
          <AppText style={styles.count} allowFontScaling={false}>{label}</AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -5,
    end: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  // Dark ink on gold reads in both themes; Latin digits in both languages.
  count: { fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 13, color: "#0e1a3c", writingDirection: "ltr" },
});
