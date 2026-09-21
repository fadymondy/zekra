import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useState } from "react";

import { AppText, Field, PrimaryButton, Screen, SecondaryButton } from "@/components/ui";
import { ApiError, authApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

type ErrorPayload = { challenge?: string; email?: string };
type Mode = "signIn" | "register" | "reset";

export default function SignInScreen() {
  const p = usePalette();
  const { t, locale, isRtl } = useI18n();
  const { token, signIn, register, finishChallenge } = useAuth();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (token) return <Redirect href="/(tabs)/notes" />;

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (challenge) {
        await finishChallenge(challenge, recovery ? { recovery_code: code.trim() } : { code: code.trim() });
      } else if (mode === "reset") {
        await authApi.forgotPassword(email.trim(), locale);
        setNotice(t("auth.resetSent"));
        return;
      } else if (mode === "register") {
        await register(email.trim(), password, name.trim());
      } else {
        await signIn(email.trim(), password);
      }
      if (mode !== "reset") router.replace("/(tabs)/notes");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "2fa_required") {
        const payload = caught.payload as ErrorPayload;
        if (payload?.challenge) { setChallenge(payload.challenge); setCode(""); return; }
      }
      setError(caught instanceof Error ? caught.message : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  const heading = challenge
    ? t("auth.twoFactor")
    : mode === "register" ? t("auth.createAccount")
    : mode === "reset" ? t("auth.resetTitle")
    : t("auth.welcome");

  const cta = challenge
    ? t("auth.verify")
    : mode === "register" ? t("auth.signUp")
    : mode === "reset" ? t("auth.sendReset")
    : t("auth.signIn");

  const canSubmit = challenge
    ? !!code.trim()
    : mode === "reset" ? !!email.trim()
    : mode === "register" ? !!email.trim() && !!password && !!name.trim()
    : !!email.trim() && !!password;

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.brand, { borderColor: p.line, backgroundColor: p.bg }]}>
            <View style={[styles.markFrame, { borderColor: p.line, backgroundColor: p.card }]}>
              <Image source={require("../assets/icon.png")} style={styles.logo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kicker, { color: p.muted }]}>MEMORY / KNOWLEDGE / GRAPH</Text>
              <Text style={[styles.wordmark, { color: p.ink }]}>Zekra</Text>
              <Text style={[styles.arabic, { color: p.gold }]}>ذكرة</Text>
            </View>
          </View>

          <View style={[styles.statement, { borderColor: p.line }]}>
            <Text style={[styles.statementNumber, { color: p.gold }]}>01</Text>
            <Text style={[styles.intro, { color: p.body, textAlign: isRtl ? "right" : "left" }]}>{t("app.tagline")}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}>
            <Text style={[styles.sectionLabel, { color: p.muted }]}>ACCOUNT / AUTHENTICATION</Text>
            <Text style={[styles.cardTitle, { color: p.ink }]}>{heading}</Text>

            {challenge ? (
              <>
                <Field
                  label={recovery ? t("auth.recoveryCode") : t("auth.authCode")}
                  value={code}
                  onChangeText={setCode}
                  keyboardType={recovery ? "default" : "number-pad"}
                  autoComplete="one-time-code"
                  autoFocus
                />
                <SecondaryButton
                  label={recovery ? t("auth.useAuthenticator") : t("auth.useRecovery")}
                  onPress={() => { setRecovery((value) => !value); setCode(""); }}
                />
              </>
            ) : (
              <>
                {mode === "register" ? (
                  <Field label={t("auth.name")} value={name} onChangeText={setName} autoComplete="name" />
                ) : null}
                <Field
                  label={t("auth.email")}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
                {mode !== "reset" ? (
                  <Field
                    label={t("auth.password")}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                  />
                ) : null}
              </>
            )}

            {error ? <Text style={[styles.error, { color: p.danger }]}>{error}</Text> : null}
            {notice ? <Text style={[styles.error, { color: p.ok }]}>{notice}</Text> : null}

            <PrimaryButton label={cta} loading={busy} disabled={!canSubmit} onPress={() => void submit()} />

            {challenge ? (
              <SecondaryButton label={t("auth.startOver")} onPress={() => { setChallenge(""); setCode(""); setError(""); }} />
            ) : (
              <View style={styles.links}>
                {mode === "signIn" ? (
                  <>
                    <Pressable onPress={() => switchMode("reset")}>
                      <Text style={[styles.link, { color: p.muted }]}>{t("auth.forgot")}</Text>
                    </Pressable>
                    <Pressable onPress={() => switchMode("register")}>
                      <Text style={[styles.link, { color: p.action }]}>{t("auth.noAccount")}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => switchMode("signIn")}>
                    <Text style={[styles.link, { color: p.action }]}>{t("auth.haveAccount")}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const mono = Platform.select({ ios: "Menlo", android: "monospace" });

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: 28, paddingBottom: 44 },
  brand: { marginHorizontal: metrics.padX, minHeight: 112, borderWidth: StyleSheet.hairlineWidth, padding: metrics.padX, flexDirection: "row", alignItems: "center", gap: 15 },
  markFrame: { width: 66, height: 66, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 46, height: 46 },
  kicker: { fontFamily: mono, fontSize: 8, letterSpacing: 1.5, marginBottom: 5 },
  wordmark: { fontSize: 34, fontWeight: "500", letterSpacing: -1 },
  arabic: { fontSize: 12, fontWeight: "700", letterSpacing: 2, marginTop: -2 },
  statement: { marginHorizontal: metrics.padX, minHeight: 72, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 13 },
  statementNumber: { fontFamily: mono, fontSize: 10, letterSpacing: 1 },
  intro: { flex: 1, fontSize: 14, lineHeight: 20 },
  card: { marginHorizontal: metrics.padX, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, padding: 17, gap: 14 },
  sectionLabel: { fontFamily: mono, fontSize: 8, letterSpacing: 1.6 },
  cardTitle: { fontSize: 22, fontWeight: "500", marginBottom: 2 },
  error: { fontSize: 13, lineHeight: 18 },
  links: { gap: metrics.gap, alignItems: "center", paddingTop: 2 },
  link: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
});
