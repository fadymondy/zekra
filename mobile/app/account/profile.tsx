import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppText, Field, Header, IconButton, PrimaryButton, Row, Screen, StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { zekraApi } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

export default function ProfileScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { token, user } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const profile = useQuery({ queryKey: ["profile", token], queryFn: () => zekraApi.profile(token!), enabled: !!token });

  useEffect(() => {
    if (!profile.data) return;
    setName(profile.data.name ?? "");
    setTimezone(profile.data.timezone ?? "");
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => zekraApi.updateProfile(token!, { name: name.trim(), timezone: timezone.trim() }),
    onSuccess: () => {
      setSaved(true); setError("");
      void client.invalidateQueries({ queryKey: ["profile"] });
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const back = (
    <IconButton label={t("common.close")} onPress={() => router.back()}>
      <ArrowLeft color={p.ink} size={20} strokeWidth={1.7} />
    </IconButton>
  );

  return (
    <Screen scroll header={<Header title={t("account.profile")} eyebrow={t("settings.account")} actions={back} />}>
      <View style={{ height: metrics.gap }} />
      {profile.isLoading ? <StatePanel loading title={t("common.loading")} /> : (
        <>
          <Row style={{ gap: 14 }}>
            <Field label={t("auth.email")} value={profile.data?.email ?? user?.email ?? ""} editable={false} />
            <Field label={t("account.name")} value={name} onChangeText={setName} />
            <Field label={t("account.timezone")} value={timezone} onChangeText={setTimezone} autoCapitalize="none" placeholder="Asia/Riyadh" />
            {error ? <AppText variant="body" color={p.danger}>{error}</AppText> : null}
            {saved ? <AppText variant="body" color={p.ok}>{t("account.saved")}</AppText> : null}
          </Row>
          <View style={{ height: metrics.gap }} />
          <View style={{ paddingHorizontal: metrics.padX }}>
            <PrimaryButton label={t("account.saveProfile")} loading={save.isPending} onPress={() => save.mutate()} />
          </View>
        </>
      )}
    </Screen>
  );
}
