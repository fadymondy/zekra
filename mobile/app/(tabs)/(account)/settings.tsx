import Constants from "expo-constants";
import { router } from "expo-router";
import { LogOut, Trash2 } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { ForwardChevron, Tile } from "@/components/kit";
import { AppText, Header, Row, Rows, Screen, SecondaryButton, SectionLabel } from "@/components/ui";
import { KIND_KEY } from "@/features/security/app-lock-gate";
import { useBiometricInfo } from "@/features/security/biometrics";
import { useAppLock } from "@/features/security/lock-store";
import { SECTIONS, SettingsItem, type SettingsSection } from "@/features/settings/settings-nav";
import { ZekraMark } from "@/features/splash/zekra-mark";
import { languageName, useI18n } from "@/lib/i18n";
import { readingTheme, useReadingSettings } from "@/lib/reading-settings";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette, useTheme } from "@/theme";

// Settings (the reference's Account tab, SCREENS.md §12): identity, then
// grouped rows of tile list items. Language and theme live here and nowhere
// else once signed in.
export default function SettingsScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const { mode } = useTheme();
  const reading = useReadingSettings();
  const { user, signOut } = useAuth();
  const version = Constants.expoConfig?.version || "development";
  const lock = useAppLock();
  const biometric = useBiometricInfo();

  const modeLabel = t(mode === "system" ? "settings.themeSystem" : mode === "light" ? "settings.themeLight" : "settings.themeDark");
  const details: Partial<Record<SettingsSection, string>> = {
    appearance: `${modeLabel} · ${languageName(locale)}`,
    reading: t("settings.x.readingDetail", { theme: readingTheme(reading.theme)?.label ?? t("settings.x.readingOwn"), size: reading.fontSize }),
    security: lock.settings.enabled
      ? t("security.detailOn", { kind: t(KIND_KEY[biometric?.kind ?? "biometrics"]), after: t(`security.after.${lock.settings.after}`) })
      : t("security.detailOff"),
    profile: user?.email,
    connect: t("settings.x.connectDetail"),
    about: t("settings.x.aboutDetail", { version }),
  };
  const item = (key: SettingsSection, last?: boolean) => {
    const s = SECTIONS.find((x) => x.key === key)!;
    return <SettingsItem key={key} last={last} Icon={s.Icon} label={t(s.label)} detail={details[key]} onPress={() => router.push(s.href)} />;
  };

  return (
    <Screen scroll header={<Header title={t("nav.account")} />}>
      <Rows style={{ paddingTop: 16 }}>
        {/* Identity → Profile */}
        <Row onPress={() => router.push("/account/profile")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
            <Tile size={48} radius={12}>
              <ZekraMark size={30} />
            </Tile>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: p.muted }}>{t("settings.signedInAs")}</AppText>
              {user?.name ? (
                <AppText numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, color: p.ink }}>{user.name}</AppText>
              ) : null}
              <AppText
                numberOfLines={1}
                style={{ fontFamily: user?.name ? fonts.regular : fonts.semibold, fontSize: user?.name ? 14 : 17, lineHeight: 23, color: user?.name ? p.muted : p.ink, writingDirection: "ltr", alignSelf: "flex-start" }}
              >
                {user?.email || t("app.name")}
              </AppText>
            </View>
            <ForwardChevron size={17} />
          </View>
        </Row>

        {/* One page per section; each page links to the others. */}
        <SectionLabel>{t("settings.x.preferences")}</SectionLabel>
        <Row style={{ paddingVertical: 0 }}>
          <View>
            {item("appearance")}
            {item("reading")}
            {item("notifications")}
            {item("security", true)}
          </View>
        </Row>

        <SectionLabel>{t("settings.account")}</SectionLabel>
        <Row style={{ paddingVertical: 0 }}>
          <View>
            {item("profile")}
            {item("password")}
            <SettingsItem last Icon={Trash2} tone="danger" label={t("account.delete")} onPress={() => router.push("/account/delete")} />
          </View>
        </Row>

        <SectionLabel>{t("settings.x.about")}</SectionLabel>
        <Row style={{ paddingVertical: 0 }}>
          <View>
            {item("connect")}
            {item("about", true)}
          </View>
        </Row>

        <Row>
          <SecondaryButton label={t("auth.signOut")} icon={<LogOut size={18} color={p.ink} strokeWidth={1.6} />} onPress={() => void signOut()} />
        </Row>
      </Rows>
    </Screen>
  );
}
