import { router } from "expo-router";
import { View } from "react-native";

import { StackHeader } from "@/components/kit";
import { AppText, Row, Rows, Screen } from "@/components/ui";
import { CancelDeletionForm } from "@/features/account/cancel-deletion";
import { useI18n, tallScript } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

// Public (signed out): a scheduled deletion signs the account out everywhere,
// so it is cancelled from here — linked from the sign-in screen — with a code
// emailed to the address (src/features/account/cancel-deletion.tsx).
export default function CancelDeletionScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/sign-in"));
  return (
    <Screen scroll header={<StackHeader title={t("deletion.cancelTitle")} onBack={back} />}>
      <Rows style={{ paddingTop: 16 }}>
        <Row>
          <View style={{ gap: 14 }}>
            <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: tallScript(locale) ? 30 : 26, color: p.body }}>{t("deletion.cancelIntro")}</AppText>
            <CancelDeletionForm />
          </View>
        </Row>
      </Rows>
    </Screen>
  );
}
