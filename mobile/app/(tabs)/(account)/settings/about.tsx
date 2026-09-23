import Constants from "expo-constants";
import { router, type Href } from "expo-router";
import { FileText, LifeBuoy, ShieldCheck } from "lucide-react-native";
import { View } from "react-native";

import { AppText, Row } from "@/components/ui";
import { SettingsItem, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

// Settings → About: legal documents, support, and the build version.
export default function AboutScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const version = Constants.expoConfig?.version || "development";
  const legal = (doc: "privacy" | "terms" | "support") => router.push({ pathname: "/legal/[doc]", params: { doc } } as Href);
  return (
    <SettingsPage section="about">
      <Row>
        <AppText variant="micro">{t("settings.legal")}</AppText>
        <View>
          <SettingsItem Icon={ShieldCheck} label={t("legal.privacy")} onPress={() => legal("privacy")} />
          <SettingsItem Icon={FileText} label={t("legal.terms")} onPress={() => legal("terms")} />
          <SettingsItem last Icon={LifeBuoy} label={t("legal.support")} onPress={() => legal("support")} />
        </View>
      </Row>
      <Row>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: p.muted }}>{t("settings.version")}</AppText>
          <AppText style={{ fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 18, color: p.muted, writingDirection: "ltr" }}>{version}</AppText>
        </View>
      </Row>
    </SettingsPage>
  );
}
