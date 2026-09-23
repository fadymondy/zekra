import { Redirect, router } from "expo-router";
import { Eye, EyeOff, KeyRound, Lock, LogIn, Mail, Shield, Smartphone, User, UserPlus, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";

import { ErrorLine, StackHeader, TextButton, Tile } from "@/components/kit";
import { AppText, CodeField, Field, PrimaryButton, Row, Rows, Screen, Segmented } from "@/components/ui";
import { cancelBrowserSignIn, SocialSignInError } from "@/features/social/browser-flow";
import { PROVIDER_NAME, SocialButtons, useSocialProviders } from "@/features/social/social-buttons";
import { socialErrorKey, type SocialProvider } from "@/features/social/social-core";
import { ZekraMark } from "@/features/splash/zekra-mark";
import { ApiError, authApi } from "@/lib/api";
import { reportError } from "@/lib/crash";
import { useI18n, type Locale } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

type ErrorPayload = { challenge?: string; email?: string };
type Mode = "signIn" | "register" | "reset";

/** Password field: lock icon, reveal toggle (§1.10). Always LTR. */
function PasswordField({ label, value, onChangeText, isNew, onSubmitEditing }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  isNew?: boolean;
  onSubmitEditing?: () => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const Toggle = shown ? EyeOff : Eye;
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={!shown}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete={isNew ? "new-password" : "current-password"}
      textContentType={isNew ? "newPassword" : "password"}
      returnKeyType="go"
      onSubmitEditing={onSubmitEditing}
      ltr
      icon={<Lock size={17} color={p.muted} strokeWidth={1.6} />}
      trailing={
        <Pressable accessibilityRole="button" accessibilityLabel={t(shown ? "auth.hidePassword" : "auth.showPassword")} onPress={() => setShown(!shown)} hitSlop={12}>
          <Toggle size={17} color={p.muted} strokeWidth={1.6} />
        </Pressable>
      }
    />
  );
}

/** 0–4: eight characters is the floor; a digit, mixed case and a symbol each add one. */
function passwordScore(pw: string) {
  if (pw.length < 8) return 0;
  let s = 1;
  if (/\d/.test(pw)) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

/** Four segments, ok-green when filled (§1.10). */
function StrengthMeter({ score, caption }: { score: number; caption: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= score ? p.ok : p.soft }} />
        ))}
      </View>
      <AppText style={{ fontFamily: fonts.light, fontSize: 11, lineHeight: 18, color: p.muted }}>{caption}</AppText>
    </View>
  );
}

/** A 42 tile with a gold icon beside an intro line (02-3 / 02-6). */
function IntroRow({ Icon, text }: { Icon: LucideIcon; text: string }) {
  const p = usePalette();
  return (
    <Row>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Tile size={42}>
          <Icon size={20} color={p.gold} strokeWidth={1.6} />
        </Tile>
        <AppText style={{ flex: 1, fontFamily: fonts.light, fontSize: 13.5, lineHeight: 25, color: p.body }}>{text}</AppText>
      </View>
    </Row>
  );
}

/** The root header (no back): the mark in its tile, the product name, the domain. */
function BrandHeader() {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <View style={[styles.brand, { borderBottomColor: p.line, backgroundColor: p.bg }]}>
      <Tile size={44} radius={10} ground="soft">
        <ZekraMark size={30} />
      </Tile>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, color: p.ink }}>{t("app.name")}</AppText>
        {/* An LTR run aligns to the left by default; pin it to the start edge so
            it sits under the title in Arabic too. */}
        <AppText variant="latin" style={{ alignSelf: "flex-start" }}>zekra.dev</AppText>
      </View>
    </View>
  );
}

/** A centred "prompt · action" line (02-1 row 3). */
function SwitchLine({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.switchLine}>
      <AppText style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: p.muted }}>
        {prompt}{" "}
        <AppText style={{ fontFamily: fonts.medium, fontSize: 13, color: p.ink }}>{action}</AppText>
      </AppText>
    </Pressable>
  );
}

// Sign in · create account · reset · two-factor (SCREENS.md 02-1…02-6), on
// Zekra's palette. One screen, one step at a time; a stack header with a back
// to sign-in on every step but the first.
export default function SignInScreen() {
  const p = usePalette();
  const { t, locale, setLocale, isRtl } = useI18n();
  const { token, signIn, register, finishChallenge, signInWith } = useAuth();
  const social = useSocialProviders();
  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);
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

  if (token) return <Redirect href="/brains" />;

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
  }

  function startOver() {
    setChallenge("");
    setCode("");
    setRecovery(false);
    setError("");
  }

  const describe = (caught: unknown) =>
    caught instanceof ApiError && caught.status === 0
      ? t("auth.offline")
      : caught instanceof ApiError && caught.status === 401 && !challenge
        ? t("auth.invalid")
        : caught instanceof Error
          ? caught.message
          : t("auth.failed");

  /** A 2FA challenge answer: switch to the code step. True when handled. */
  function takeChallenge(caught: unknown) {
    if (caught instanceof ApiError && caught.code === "2fa_required") {
      const payload = caught.payload as ErrorPayload;
      if (payload?.challenge) {
        setChallenge(payload.challenge);
        setCode("");
        return true;
      }
    }
    return false;
  }

  // Google / Apple / GitHub. Closing the provider's sheet is not an error:
  // nothing is shown. A 2FA challenge continues on the same code step as a
  // password sign-in.
  // The button shows its spinner (and the others dim) while the sign-in is in
  // the system browser; every failure lands on the error line.
  async function signInWithProvider(provider: SocialProvider) {
    if (busy || socialBusy) return;
    setSocialBusy(provider);
    setError("");
    setNotice("");
    try {
      if (await signInWith(provider, social?.google ?? "browser")) router.replace("/brains");
    } catch (caught) {
      if (takeChallenge(caught)) return;
      if (!(caught instanceof ApiError) && !(caught instanceof SocialSignInError)) reportError(caught, `social sign-in ${provider}`);
      const key = socialErrorKey(provider, caught instanceof ApiError
        ? { status: caught.status, code: caught.code, message: caught.message }
        : caught instanceof SocialSignInError ? { reason: caught.reason } : {});
      setError(t(key, { provider: PROVIDER_NAME[provider] }));
    } finally {
      setSocialBusy(null);
    }
  }

  async function submit(codeNow?: string) {
    if (busy || socialBusy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (challenge) {
        const answer = (codeNow ?? code).trim();
        await finishChallenge(challenge, recovery ? { recovery_code: answer } : { code: answer });
      } else if (mode === "reset") {
        await authApi.forgotPassword(email.trim(), locale);
        setNotice(t("auth.resetSent"));
        return;
      } else if (mode === "register") {
        await register(email.trim(), password, name.trim());
      } else {
        await signIn(email.trim(), password);
      }
      router.replace("/brains");
    } catch (caught) {
      if (takeChallenge(caught)) return;
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  const emailField = (
    <Field
      label={t("auth.email")}
      value={email}
      onChangeText={setEmail}
      placeholder="name@example.com"
      keyboardType="email-address"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      textContentType="username"
      returnKeyType={mode === "reset" ? "send" : "next"}
      onSubmitEditing={mode === "reset" ? () => void submit() : undefined}
      ltr
      icon={<Mail size={17} color={p.muted} strokeWidth={1.6} />}
    />
  );

  const feedback = (
    <>
      {error ? <ErrorLine text={error} /> : null}
      {notice ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <View style={{ width: 7, height: 7, backgroundColor: p.ok }} />
          <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 20, color: p.ok }}>{notice}</AppText>
        </View>
      ) : null}
    </>
  );

  let header: ReactNode;
  let body: ReactNode;

  if (challenge) {
    header = <StackHeader title={t("auth.twoFactor")} subtitle={t("auth.step", { n: 2, total: 2 })} onBack={startOver} />;
    body = (
      <>
        <IntroRow Icon={recovery ? KeyRound : Smartphone} text={t(recovery ? "auth.recoveryIntro" : "auth.twoFactorIntro")} />
        <Row>
          {recovery ? (
            <Field
              label={t("auth.recoveryCode")}
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              ltr
              style={{ fontFamily: fonts.mono }}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              icon={<KeyRound size={17} color={p.muted} strokeWidth={1.6} />}
            />
          ) : (
            <View style={{ gap: 8 }}>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, color: p.muted }}>{t("auth.authCode")}</AppText>
              <CodeField value={code} onChangeText={setCode} autoFocus label={t("auth.authCode")} onComplete={(v) => void submit(v)} />
            </View>
          )}
          {feedback}
          <PrimaryButton
            label={t("auth.verify")}
            icon={<Shield size={18} color={p.onAction} strokeWidth={1.6} />}
            loading={busy}
            disabled={recovery ? !code.trim() : code.length < 6}
            onPress={() => void submit()}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setRecovery((v) => !v);
              setCode("");
              setError("");
            }}
            style={styles.inlineAction}
          >
            <KeyRound size={15} color={p.gold} strokeWidth={1.6} />
            <AppText style={{ fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 20, color: p.gold }}>
              {t(recovery ? "auth.useAuthenticator" : "auth.useRecovery")}
            </AppText>
          </Pressable>
        </Row>
        <Row style={{ paddingVertical: 10 }}>
          <TextButton muted label={t("auth.startOver")} onPress={startOver} />
        </Row>
      </>
    );
  } else if (mode === "reset") {
    header = <StackHeader title={t("auth.resetTitle")} onBack={() => switchMode("signIn")} />;
    body = (
      <>
        <IntroRow Icon={KeyRound} text={t("auth.resetIntro")} />
        <Row>
          {emailField}
          {feedback}
          <PrimaryButton
            label={t("auth.sendReset")}
            icon={<Mail size={18} color={p.onAction} strokeWidth={1.6} />}
            loading={busy}
            disabled={!email.includes("@")}
            onPress={() => void submit()}
          />
          <TextButton muted label={t("auth.backToSignIn")} onPress={() => switchMode("signIn")} />
        </Row>
      </>
    );
  } else if (mode === "register") {
    header = <StackHeader title={t("auth.createAccount")} onBack={() => switchMode("signIn")} />;
    body = (
      <>
        <Row>
          <Field
            label={t("auth.name")}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            icon={<User size={17} color={p.muted} strokeWidth={1.6} />}
          />
          {emailField}
          <PasswordField label={t("auth.password")} value={password} onChangeText={setPassword} isNew />
          <StrengthMeter score={passwordScore(password)} caption={t("auth.strengthHint")} />
          {feedback}
          <PrimaryButton
            label={t("auth.signUp")}
            icon={<UserPlus size={18} color={p.onAction} strokeWidth={1.6} />}
            loading={busy}
            disabled={!email.includes("@") || password.length < 8 || !name.trim()}
            onPress={() => void submit()}
          />
        </Row>
        <Row style={{ paddingVertical: 10 }}>
          <SwitchLine prompt={t("auth.haveAccountPrompt")} action={t("auth.signInLink")} onPress={() => switchMode("signIn")} />
        </Row>
      </>
    );
  } else {
    header = <BrandHeader />;
    body = (
      <>
        <Row>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <ZekraMark size={38} tight />
            <View style={{ width: 1, height: 38, backgroundColor: p.line }} />
            <AppText style={{ flex: 1, fontFamily: fonts.light, fontSize: 13.5, lineHeight: 24, color: p.muted }}>{t("auth.intro")}</AppText>
          </View>
        </Row>
        <Row>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 19, lineHeight: 30, color: p.ink }}>{t("auth.welcome")}</AppText>
          {emailField}
          <PasswordField label={t("auth.password")} value={password} onChangeText={setPassword} onSubmitEditing={() => void submit()} />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Pressable accessibilityRole="button" onPress={() => switchMode("reset")} style={{ minHeight: 44, justifyContent: "center" }}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 20, color: p.gold }}>{t("auth.forgot")}</AppText>
            </Pressable>
          </View>
          {feedback}
          <PrimaryButton
            label={t("auth.signIn")}
            icon={
              // Mirrored in Arabic. The flip goes on a wrapper: a transform on
              // the Svg itself makes react-native-svg drop the icon.
              <View style={isRtl ? { transform: [{ scaleX: -1 }] } : undefined}>
                <LogIn size={18} color={p.onAction} strokeWidth={1.6} />
              </View>
            }
            loading={busy}
            disabled={!email.includes("@") || !password || !!socialBusy}
            onPress={() => void submit()}
          />
          {social?.providers.length ? (
            <SocialButtons providers={social.providers} running={socialBusy} disabled={busy} onPress={(provider) => void signInWithProvider(provider)} />
          ) : null}
          {socialBusy === "github" || socialBusy === "google" ? (
            // Sign-in continues in the system browser; it returns via zekra://.
            <View style={{ alignItems: "center", gap: 2 }}>
              <AppText variant="meta" style={{ textAlign: "center" }}>
                {t("social.inBrowser", { provider: PROVIDER_NAME[socialBusy] })}
              </AppText>
              <TextButton label={t("social.cancelBrowser")} onPress={cancelBrowserSignIn} />
            </View>
          ) : null}
        </Row>
        <Row style={{ paddingVertical: 10 }}>
          <SwitchLine prompt={t("auth.noAccountPrompt")} action={t("auth.createOne")} onPress={() => switchMode("register")} />
        </Row>
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen scroll header={header}>
        <Rows style={{ paddingTop: metrics.gap }}>
          {body}
          {/* Language before sign-in: Settings is not reachable yet. */}
          <Row>
            <AppText variant="micro">{t("settings.language")}</AppText>
            <Segmented<Locale>
              value={locale}
              onChange={setLocale}
              options={[
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: metrics.padX, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  switchLine: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  inlineAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
});
