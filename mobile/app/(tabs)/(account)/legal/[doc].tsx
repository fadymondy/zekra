import { useLocalSearchParams } from "expo-router";
import { ExternalLink, Mail } from "lucide-react-native";
import { Linking, View } from "react-native";

import { ForwardChevron, ListItem, StackHeader, Tile } from "@/components/kit";
import { AppText, Row, Rows, Screen, SecondaryButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

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
  const entry = DOCS[doc as keyof typeof DOCS] ?? DOCS.privacy;
  const url = `${SITE}/${locale}${entry.path}`;
  const support = doc === "support";

  return (
    <Screen scroll header={<StackHeader title={t(entry.key)} subtitle={url.replace(/^https:\/\//, "").toUpperCase()} />}>
      <Rows style={{ paddingTop: 16 }}>
        <Row>
          <AppText style={{ fontFamily: fonts.light, fontSize: 13.5, lineHeight: locale === "ar" ? 27 : 23, color: p.body }}>
            {support ? t("legal.supportBody") : t("legal.intro")}
          </AppText>
          {support ? (
            <View>
              <ListItem
                last
                onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
                leading={
                  <Tile size={34}>
                    <Mail size={17} color={p.gold} strokeWidth={1.6} />
                  </Tile>
                }
                trailing={<ForwardChevron size={17} />}
              >
                <AppText style={{ fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 21, color: p.ink }}>{t("legal.email")}</AppText>
                <AppText selectable style={{ fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 18, color: p.muted, writingDirection: "ltr", alignSelf: "flex-start" }}>
                  {SUPPORT_EMAIL}
                </AppText>
              </ListItem>
            </View>
          ) : null}
          <SecondaryButton
            label={t("legal.openInBrowser")}
            icon={<ExternalLink size={17} color={p.ink} strokeWidth={1.6} />}
            onPress={() => void Linking.openURL(url)}
          />
        </Row>
      </Rows>
    </Screen>
  );
}
