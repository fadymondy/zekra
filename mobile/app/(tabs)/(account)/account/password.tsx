import { KeyRound, Mail } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { ErrorLine, Tile } from "@/components/kit";
import { AppText, PrimaryButton, Row } from "@/components/ui";
import { authApi } from "@/lib/api";
import { SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

// The API has no authenticated change-password route; the supported path is the
// emailed reset link (POST /api/auth/password/forgot -> /password/reset), which
// also proves control of the mailbox.
export default function PasswordScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!user?.email) return;
    setBusy(true);
    setError("");
    try {
      await authApi.forgotPassword(user.email, locale);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("account.linkFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage section="password">
      <Row>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Tile size={42}>
            <KeyRound size={20} color={p.gold} strokeWidth={1.6} />
          </Tile>
          <AppText style={{ flex: 1, fontFamily: fonts.light, fontSize: 13.5, lineHeight: 25, color: p.body }}>{t("account.passwordBody")}</AppText>
        </View>
      </Row>
      <Row>
        <View style={{ gap: 4 }}>
          <AppText style={{ fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, color: p.muted }}>{t("account.sentTo")}</AppText>
          <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 20, color: p.ink, writingDirection: "ltr", alignSelf: "flex-start" }}>
            {user?.email ?? "—"}
          </AppText>
        </View>
        {error ? <ErrorLine text={error} /> : null}
        {sent ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <View style={{ width: 7, height: 7, backgroundColor: p.ok }} />
            <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 20, color: p.ok }}>{t("account.passwordSent")}</AppText>
          </View>
        ) : null}
        <PrimaryButton
          label={t("account.sendPasswordLink")}
          icon={<Mail size={18} color={p.onAction} strokeWidth={1.6} />}
          loading={busy}
          disabled={!user?.email}
          onPress={() => void send()}
        />
      </Row>
    </SettingsPage>
  );
}
