import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, LogOut, Trash2, TriangleAlert, Undo2 } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { ErrorLine, QueryStatus } from "@/components/kit";
import { AppText, Field, Row, SecondaryButton } from "@/components/ui";
import { zekraApi } from "@/lib/api";
import { SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

// Apple and Google both require in-app account deletion. The API schedules the
// delete (password-confirmed) rather than purging immediately, and it can be
// cancelled until it runs.
export default function DeleteAccountScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const { token, user, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const state = useQuery({ queryKey: ["delete-state", token], queryFn: () => zekraApi.deleteState(token!), enabled: !!token });

  const remove = useMutation({
    mutationFn: () => zekraApi.deleteAccount(token!, password),
    onSuccess: () => {
      setError("");
      setPassword("");
      void state.refetch();
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t("account.deleteFailed")),
  });

  const cancel = useMutation({
    mutationFn: () => zekraApi.cancelDelete(token!),
    onSuccess: () => {
      setError("");
      void state.refetch();
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t("account.cancelFailed")),
  });

  const scheduled = state.data?.status === "scheduled";
  const when = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
  };

  return (
    <SettingsPage title={t("account.delete")}>
      {state.isPending || state.error ? (
        <QueryStatus q={state} lines={2} />
      ) : scheduled ? (
        <Row>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TriangleAlert size={19} color={p.warn} strokeWidth={1.6} />
            <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 22, color: p.ink }}>{t("account.deleteScheduled")}</AppText>
          </View>
          <AppText style={{ fontFamily: fonts.light, fontSize: 13.5, lineHeight: locale === "ar" ? 27 : 23, color: p.body }}>{t("account.deleteScheduledBody")}</AppText>
          <View style={{ gap: 4 }}>
            <AppText style={{ fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, color: p.muted }}>{t("account.deleteScheduledFor")}</AppText>
            <AppText style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, color: p.gold, writingDirection: "ltr", alignSelf: "flex-start" }}>{when(state.data?.scheduled_for)}</AppText>
          </View>
          {error ? <ErrorLine text={error} /> : null}
          <SecondaryButton
            label={t("account.cancelDelete")}
            icon={<Undo2 size={18} color={p.ink} strokeWidth={1.6} />}
            loading={cancel.isPending}
            onPress={() => cancel.mutate()}
          />
        </Row>
      ) : (
        <>
          <Row>
            <AppText variant="micro">{t("account.deleteWhat")}</AppText>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <View style={{ width: 6, height: 6, marginTop: 9, backgroundColor: p.danger }} />
              <AppText style={{ flex: 1, fontFamily: fonts.light, fontSize: 13.5, lineHeight: locale === "ar" ? 27 : 23, color: p.body }}>{t("account.deleteWarn")}</AppText>
            </View>
          </Row>
          <Row>
            <View style={{ gap: 4 }}>
              <AppText variant="micro">{t("settings.signedInAs")}</AppText>
              <AppText numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: p.ink, writingDirection: "ltr", alignSelf: "flex-start" }}>
                {user?.email ?? "—"}
              </AppText>
            </View>
            <Field
              label={t("account.currentPassword")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              ltr
              icon={<Lock size={17} color={p.muted} strokeWidth={1.6} />}
            />
            {error ? <ErrorLine text={error} /> : null}
            <SecondaryButton
              tone="danger"
              label={t("account.deleteConfirm")}
              icon={<Trash2 size={18} color={p.danger} strokeWidth={1.6} />}
              loading={remove.isPending}
              disabled={!password}
              onPress={() => remove.mutate()}
            />
          </Row>
        </>
      )}
      <Row>
        <SecondaryButton label={t("auth.signOut")} icon={<LogOut size={18} color={p.ink} strokeWidth={1.6} />} onPress={() => void signOut()} />
      </Row>
    </SettingsPage>
  );
}
