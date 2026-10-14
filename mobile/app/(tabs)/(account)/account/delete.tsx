import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, LogOut, Mail, Trash2, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { ErrorLine, QueryStatus, TextButton } from "@/components/kit";
import { AppText, CodeField, Field, Row, SecondaryButton } from "@/components/ui";
import { CancelDeletionForm } from "@/features/account/cancel-deletion";
import { SettingsPage } from "@/features/settings/settings-nav";
import { ApiError, zekraApi, type DeletionProof } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

// Apple and Google both require in-app account deletion, for every account.
// The API schedules the delete rather than purging at once, re-authenticated by
// the password or — for accounts made with Google / Apple / GitHub, which have
// none — a 6-digit code mailed to the address (POST /api/me/delete/code).
// Scheduling signs the account out everywhere, this token included, so the
// scheduled view cancels with an emailed code and no session
// (src/features/account/cancel-deletion.tsx), then "Done" signs out here.
export default function DeleteAccountScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const { token, user, signOut } = useAuth();
  const [chosen, setChosen] = useState<"password" | "code">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const state = useQuery({ queryKey: ["delete-state", token], queryFn: () => zekraApi.deleteState(token!), enabled: !!token && scheduledFor === null });
  const profile = useQuery({ queryKey: ["account-profile", token], queryFn: () => zekraApi.profile(token!), enabled: !!token });
  // An older server does not report has_password: assume a password.
  const hasPassword = profile.data?.has_password !== false;
  const mode = hasPassword ? chosen : "code";

  const sendCode = useMutation({
    mutationFn: () => zekraApi.deleteCode(token!, locale),
    onSuccess: () => {
      setError("");
      setCodeSent(true);
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 429 ? t("social.tooMany") : e instanceof Error && e.message ? e.message : t("account.deleteFailed")),
  });

  const remove = useMutation({
    mutationFn: (proof: DeletionProof) => zekraApi.deleteAccount(token!, proof),
    onSuccess: (res) => {
      setError("");
      setPassword("");
      setCode("");
      setScheduledFor(res?.scheduled_for ?? "");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422 && mode === "code") setError(t("deletion.codeWrong"));
      else if (e instanceof ApiError && e.status === 429) setError(t("social.tooMany"));
      else setError(e instanceof Error && e.message ? e.message : t("account.deleteFailed"));
    },
  });

  const when = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
  };

  const scheduled = scheduledFor !== null || state.data?.status === "scheduled";
  const date = scheduledFor ?? state.data?.scheduled_for;

  return (
    <SettingsPage title={t("account.delete")}>
      {scheduled ? (
        <>
          <Row>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TriangleAlert size={19} color={p.warn} strokeWidth={1.6} />
              <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, color: p.ink }}>{t("account.deleteScheduled")}</AppText>
            </View>
            <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: locale === "ar" ? 30 : 26, color: p.body }}>{t("deletion.scheduledBody")}</AppText>
            <View style={{ gap: 4 }}>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 19, color: p.muted }}>{t("account.deleteScheduledFor")}</AppText>
              <AppText style={{ fontFamily: fonts.mono, fontSize: 14.5, lineHeight: 22, color: p.action, writingDirection: "ltr", alignSelf: "flex-start" }}>{when(date)}</AppText>
            </View>
          </Row>
          <Row>
            <AppText variant="micro">{t("deletion.cancelTitle")}</AppText>
            <CancelDeletionForm initialEmail={user?.email ?? ""} />
          </Row>
          <Row>
            <SecondaryButton label={t("deletion.signOut")} icon={<LogOut size={18} color={p.ink} strokeWidth={1.6} />} onPress={() => void signOut()} />
          </Row>
        </>
      ) : state.isPending || state.error ? (
        <QueryStatus q={state} lines={2} />
      ) : (
        <>
          <Row>
            <AppText variant="micro">{t("account.deleteWhat")}</AppText>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <View style={{ width: 6, height: 6, marginTop: 9, backgroundColor: p.danger }} />
              <AppText style={{ flex: 1, fontFamily: fonts.light, fontSize: 15, lineHeight: locale === "ar" ? 30 : 26, color: p.body }}>{t("account.deleteWarn")}</AppText>
            </View>
          </Row>
          <Row>
            <View style={{ gap: 4 }}>
              <AppText variant="micro">{t("settings.signedInAs")}</AppText>
              <AppText numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 23, color: p.ink, writingDirection: "ltr", alignSelf: "flex-start" }}>
                {user?.email ?? "—"}
              </AppText>
            </View>
            {mode === "password" ? (
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
            ) : (
              <View style={{ gap: 12 }}>
                {!hasPassword ? (
                  <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: locale === "ar" ? 27 : 23, color: p.body }}>{t("deletion.noPasswordBody")}</AppText>
                ) : null}
                {codeSent ? (
                  <>
                    <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: locale === "ar" ? 27 : 23, color: p.body }}>
                      {t("deletion.codeSent", { email: user?.email ?? "" })}
                    </AppText>
                    <CodeField label={t("deletion.code")} value={code} onChangeText={setCode} />
                  </>
                ) : null}
                <SecondaryButton
                  label={codeSent ? t("deletion.resendCode") : t("deletion.sendCode")}
                  icon={<Mail size={18} color={p.ink} strokeWidth={1.6} />}
                  loading={sendCode.isPending}
                  onPress={() => sendCode.mutate()}
                />
              </View>
            )}
            {hasPassword ? (
              <View style={{ alignItems: "flex-start" }}>
                <TextButton
                  label={mode === "password" ? t("deletion.useCode") : t("deletion.usePassword")}
                  onPress={() => {
                    setChosen(mode === "password" ? "code" : "password");
                    setError("");
                  }}
                />
              </View>
            ) : null}
            {error ? <ErrorLine text={error} /> : null}
            <SecondaryButton
              tone="danger"
              label={t("account.deleteConfirm")}
              icon={<Trash2 size={18} color={p.danger} strokeWidth={1.6} />}
              loading={remove.isPending}
              disabled={mode === "password" ? !password : code.length !== 6}
              onPress={() => remove.mutate(mode === "password" ? { password } : { code })}
            />
          </Row>
          <Row>
            <SecondaryButton label={t("auth.signOut")} icon={<LogOut size={18} color={p.ink} strokeWidth={1.6} />} onPress={() => void signOut()} />
          </Row>
        </>
      )}
    </SettingsPage>
  );
}
