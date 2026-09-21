import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, ExternalLink } from "lucide-react-native";
import { Linking, View } from "react-native";

import { AppText, Header, IconButton, Row, Screen, SecondaryButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { metrics, usePalette } from "@/theme";

// The App Store and Play Store both require reachable privacy/terms/support
// pages. They are authored once on the marketing site; the app links out rather
// than forking the copy (which would drift out of sync with the legal text).
const DOCS = {
  privacy: { key: "legal.privacy", path: "/legal/privacy" },
  terms: { key: "legal.terms", path: "/legal/terms" },
  support: { key: "legal.support", path: "/support" },
} as const;

const SITE = "https://zekra.dev";
const SUPPORT_EMAIL = "info@3x1.io";

export default function LegalScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const entry = DOCS[(doc as keyof typeof DOCS)] ?? DOCS.privacy;
  const url = `${SITE}/${locale}${entry.path}`;

  const back = (
    <IconButton label={t("common.close")} onPress={() => router.back()}>
      <ArrowLeft color={p.ink} size={20} strokeWidth={1.7} />
    </IconButton>
  );

  return (
    <Screen scroll header={<Header title={t(entry.key)} eyebrow={t("app.name")} actions={back} />}>
      <View style={{ height: metrics.gap }} />
      <Row style={{ gap: 12 }}>
        {doc === "support" ? (
          <>
            <AppText variant="body">{t("legal.supportBody")}</AppText>
            <AppText variant="rowTitle" selectable>{SUPPORT_EMAIL}</AppText>
          </>
        ) : (
          <AppText variant="body">{url}</AppText>
        )}
      </Row>
      <View style={{ height: metrics.gap }} />
      <View style={{ paddingHorizontal: metrics.padX, gap: 12 }}>
        {doc === "support" ? (
          <SecondaryButton label={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
        ) : null}
        <SecondaryButton label={t("legal.openInBrowser")} onPress={() => void Linking.openURL(url)} />
      </View>
    </Screen>
  );
}
