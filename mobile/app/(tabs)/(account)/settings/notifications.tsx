import { AppText, Row } from "@/components/ui";
import { NotificationSettingsRow } from "@/features/push/notification-settings";
import { SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

// Settings → Notifications: the only place the app asks for push permission.
export default function NotificationsScreen() {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <SettingsPage section="notifications">
      <Row style={{ gap: 0, paddingVertical: 0 }}>
        <NotificationSettingsRow />
      </Row>
      <Row>
        <AppText style={{ fontFamily: fonts.light, fontSize: 12.5, lineHeight: 20, color: p.muted }}>{t("settings.x.notificationsBody")}</AppText>
      </Row>
    </SettingsPage>
  );
}
