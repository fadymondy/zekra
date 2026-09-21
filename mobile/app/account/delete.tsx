import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowLeft, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText, Field, Header, IconButton, Row, Screen, SecondaryButton, StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { zekraApi } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

// Apple and Google both require in-app account deletion. The API schedules the
// delete (password-confirmed) rather than purging immediately, and it can be
// cancelled until it runs.
export default function DeleteAccountScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { token, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const state = useQuery({ queryKey: ["delete-state", token], queryFn: () => zekraApi.deleteState(token!), enabled: !!token });

  const remove = useMutation({
    mutationFn: () => zekraApi.deleteAccount(token!, password),
    onSuccess: () => { setError(""); void state.refetch(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not schedule deletion"),
  });

  const cancel = useMutation({
    mutationFn: () => zekraApi.cancelDelete(token!),
    onSuccess: () => { setError(""); void state.refetch(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not cancel"),
  });

  const back = (
    <IconButton label={t("common.close")} onPress={() => router.back()}>
      <ArrowLeft color={p.ink} size={20} strokeWidth={1.7} />
    </IconButton>
  );

  const scheduled = state.data?.status === "scheduled";

  return (
    <Screen scroll header={<Header title={t("account.delete")} eyebrow={t("settings.account")} actions={back} />}>
      <View style={{ height: metrics.gap }} />
      {state.isLoading ? <StatePanel loading title={t("common.loading")} /> : scheduled ? (
        <>
          <Row style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TriangleAlert color={p.warn} size={20} strokeWidth={1.7} />
              <AppText variant="rowTitle" style={{ flex: 1 }}>{t("account.deleteScheduled")}</AppText>
            </View>
            <AppText variant="body">{t("account.deleteScheduledBody")}</AppText>
            {state.data?.scheduled_for ? <AppText variant="micro">{state.data.scheduled_for}</AppText> : null}
            {error ? <AppText variant="body" color={p.danger}>{error}</AppText> : null}
          </Row>
          <View style={{ height: metrics.gap }} />
          <View style={{ paddingHorizontal: metrics.padX }}>
            <SecondaryButton label={t("account.cancelDelete")} loading={cancel.isPending} onPress={() => cancel.mutate()} />
          </View>
        </>
      ) : (
        <>
          <Row style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TriangleAlert color={p.danger} size={20} strokeWidth={1.7} />
              <AppText variant="rowTitle" color={p.danger} style={{ flex: 1 }}>{t("account.delete")}</AppText>
            </View>
            <AppText variant="body">{t("account.deleteWarn")}</AppText>
            <Field label={t("account.currentPassword")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
            {error ? <AppText variant="body" color={p.danger}>{error}</AppText> : null}
          </Row>
          <View style={{ height: metrics.gap }} />
          <View style={{ paddingHorizontal: metrics.padX, gap: 12 }}>
            <SecondaryButton
              tone="danger"
              label={t("account.deleteConfirm")}
              loading={remove.isPending}
              disabled={!password}
              onPress={() => remove.mutate()}
            />
            <SecondaryButton label={t("auth.signOut")} onPress={() => void signOut()} />
          </View>
        </>
      )}
    </Screen>
  );
}
