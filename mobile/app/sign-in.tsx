import { Image, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useState } from "react";

import { Button, Field, HatchBand, Screen } from "@/components/ui";
import { API_URL, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

type ErrorPayload = { challenge?: string; email?: string };

export default function SignInScreen() {
  const p = usePalette();
  const { token, signIn, finishChallenge } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (token) return <Redirect href="/(tabs)/notes" />;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (challenge) {
        await finishChallenge(challenge, recovery ? { recovery_code: code.trim() } : { code: code.trim() });
      } else {
        await signIn(email, password);
      }
      router.replace("/(tabs)/notes");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "2fa_required") {
        const payload = caught.payload as ErrorPayload;
        if (payload?.challenge) { setChallenge(payload.challenge); setCode(""); return; }
      }
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

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
          <HatchBand label="secure access" />
          <View style={[styles.statement, { borderColor: p.line }]}>
            <Text style={[styles.statementNumber, { color: p.gold }]}>01</Text>
            <Text style={[styles.intro, { color: p.body }]}>Your notes, brains, and connected knowledge — carried with you.</Text>
          </View>

          <View style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}>
            <Text style={[styles.sectionLabel, { color: p.muted }]}>ACCOUNT / AUTHENTICATION</Text>
            <Text style={[styles.cardTitle, { color: p.ink }]}>{challenge ? "Two-factor check" : "Welcome back"}</Text>
            {challenge ? (
              <>
                <Field
                  label={recovery ? "Recovery code" : "Authenticator code"}
                  value={code}
                  onChangeText={setCode}
                  keyboardType={recovery ? "default" : "number-pad"}
                  autoComplete="one-time-code"
                  autoFocus
                />
                <Button label={recovery ? "Use authenticator instead" : "Use a recovery code"} tone="quiet" onPress={() => { setRecovery((value) => !value); setCode(""); }} />
              </>
            ) : (
              <>
                <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
                <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
              </>
            )}
            {error ? <Text style={[styles.error, { color: p.danger }]}>{error}</Text> : null}
            <Button
              label={challenge ? "Verify and continue" : "Sign in"}
              loading={busy}
              disabled={challenge ? !code.trim() : !email.trim() || !password}
              onPress={() => void submit()}
            />
            {challenge ? <Button label="Start over" tone="quiet" onPress={() => { setChallenge(""); setCode(""); setError(""); }} /> : null}
          </View>
          <Text onPress={() => void Linking.openURL(`${API_URL}/en/register`)} style={[styles.link, { color: p.action, borderColor: p.line }]}>CREATE AN ACCOUNT →</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: 28, paddingBottom: 44 },
  brand: { marginHorizontal: 16, minHeight: 112, borderWidth: StyleSheet.hairlineWidth, padding: 16, flexDirection: "row", alignItems: "center", gap: 15 },
  markFrame: { width: 66, height: 66, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 46, height: 46 },
  kicker: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 8, letterSpacing: 1.5, marginBottom: 5 },
  wordmark: { fontSize: 34, fontWeight: "500", letterSpacing: -1 },
  arabic: { fontSize: 12, fontWeight: "700", letterSpacing: 2, marginTop: -2 },
  statement: { marginHorizontal: 16, minHeight: 72, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 13 },
  statementNumber: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10, letterSpacing: 1 },
  intro: { flex: 1, fontSize: 14, lineHeight: 20 },
  card: { marginHorizontal: 16, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, padding: 17, gap: 14 },
  sectionLabel: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 8, letterSpacing: 1.6 },
  cardTitle: { fontSize: 22, fontWeight: "500", marginBottom: 2 },
  error: { fontSize: 13, lineHeight: 18 },
  link: { marginHorizontal: 16, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, textAlign: "center", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10, letterSpacing: 1.1, paddingVertical: 17 },
});
