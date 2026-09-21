import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText, Header, IconButton, PrimaryButton, Row, Screen } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { authApi } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

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
    setBusy(true); setError("");
    try {
      await authApi.forgotPassword(user.email, locale);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the link");
    } finally { setBusy(false); }
  }

  const back = (
    <IconButton label={t("common.close")} onPress={() => router.back()}>
      <ArrowLeft color={p.ink} size={20} strokeWidth={1.7} />
    </IconButton>
  );

  return (
    <Screen scroll header={<Header title={t("account.password")} eyebrow={t("settings.account")} actions={back} />}>
      <View style={{ height: metrics.gap }} />
      <Row style={{ gap: 12 }}>
        <AppText variant="body">{t("account.passwordBody")}</AppText>
        <AppText variant="micro">{(user?.email ?? "").toUpperCase()}</AppText>
        {error ? <AppText variant="body" color={p.danger}>{error}</AppText> : null}
        {sent ? <AppText variant="body" color={p.ok}>{t("account.passwordSent")}</AppText> : null}
      </Row>
      <View style={{ height: metrics.gap }} />
      <View style={{ paddingHorizontal: metrics.padX }}>
        <PrimaryButton label={t("account.sendPasswordLink")} loading={busy} disabled={!user?.email} onPress={() => void send()} />
      </View>
    </Screen>
  );
}
