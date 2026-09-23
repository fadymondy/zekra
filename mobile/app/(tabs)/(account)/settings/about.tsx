import Constants from "expo-constants";
import { router, type Href } from "expo-router";
import { Bug, FileText, LifeBuoy, MessageSquare, ShieldCheck, Vibrate } from "lucide-react-native";
import { Platform, Switch, View } from "react-native";

import { AppText, Row } from "@/components/ui";
import { feedbackEnabled, openReport, useShakeSetting } from "@/features/mahaam";
import { SettingsItem, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

// Settings → About: legal documents, support, and the build version.
export default function AboutScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const version = Constants.expoConfig?.version || "development";
  const [shake, setShake] = useShakeSetting();
  const legal = (doc: "privacy" | "terms" | "support") => router.push({ pathname: "/legal/[doc]", params: { doc } } as Href);
  return (
    <SettingsPage section="about">
      {feedbackEnabled() ? (
        <Row>
          <AppText variant="micro">{t("mahaam.feedback")}</AppText>
          <View>
            <SettingsItem Icon={Bug} label={t("mahaam.report")} detail={t("mahaam.reportDetail")} onPress={() => openReport({ kind: "bug" })} />
            <SettingsItem last={Platform.OS === "web"} Icon={MessageSquare} label={t("mahaam.feedback")} detail={t("mahaam.feedbackDetail")} onPress={() => openReport({ kind: "idea" })} />
            {Platform.OS !== "web" ? (
              <SettingsItem
                last
                Icon={Vibrate}
                label={t("mahaam.shake")}
                detail={t("mahaam.shakeDetail")}
                trailing={<Switch value={shake} onValueChange={setShake} trackColor={{ true: p.action }} accessibilityLabel={t("mahaam.shake")} />}
              />
            ) : null}
          </View>
        </Row>
      ) : null}
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
