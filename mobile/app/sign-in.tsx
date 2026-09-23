import { Redirect, router } from "expo-router";
import { Eye, EyeOff, Globe } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LanguageList } from "@/components/language-list";
import { BottomSheet, ErrorLine, useChevrons } from "@/components/kit";
import { AppText, CodeField, Field, IconButton, PrimaryButton } from "@/components/ui";
import { cancelBrowserSignIn, SocialSignInError } from "@/features/social/browser-flow";
import { PROVIDER_NAME, SocialButtons, useSocialProviders } from "@/features/social/social-buttons";
import { socialErrorKey, type SocialProvider } from "@/features/social/social-core";
import { ZekraMark } from "@/features/splash/zekra-mark";
import { ApiError, authApi } from "@/lib/api";
import { reportError } from "@/lib/crash";
import { languageName, useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

type ErrorPayload = { challenge?: string; email?: string };
type Mode = "signIn" | "register" | "reset";

/** Password field: a label row, the reveal toggle. Always LTR. */
function PasswordField({ label, labelAction, value, onChangeText, isNew, onSubmitEditing }: {
  label: string;
  /** Shown at the end of the label row ("Forgot password?"). */
  labelAction?: ReactNode;
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
    <View style={{ gap: 7 }}>
    <FieldLabel label={label} action={labelAction} />
    <Field
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
      trailing={
        <Pressable accessibilityRole="button" accessibilityLabel={t(shown ? "auth.hidePassword" : "auth.showPassword")} onPress={() => setShown(!shown)} hitSlop={12}>
          <Toggle size={17} color={p.muted} strokeWidth={1.6} />
        </Pressable>
      }
    />
    </View>
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
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= score ? p.ok : p.field }} />
        ))}
      </View>
      <AppText style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: p.muted }}>{caption}</AppText>
    </View>
  );
}

/** A centred "prompt · action" line (02-1 row 3). */
function SwitchLine({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.switchLine}>
      <AppText style={{ fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22, color: p.muted }}>
        {prompt}{" "}
        <AppText style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: p.action }}>{action}</AppText>
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
    />
  );

  const feedback = (
    <>
      {error ? <ErrorLine text={error} /> : null}
      {notice ? <AppText style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: p.ok }}>{notice}</AppText> : null}
    </>
  );

  if (challenge) {
    return (
      <AuthShell
        title={t("auth.twoFactor")}
        subtitle={t(recovery ? "auth.recoveryIntro" : "auth.twoFactorIntro")}
        onBack={startOver}
        footer={<TextLink label={t("auth.startOver")} muted onPress={startOver} />}
      >
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
          />
        ) : (
          <View style={{ gap: 7 }}>
            <FieldLabel label={t("auth.authCode")} />
            <CodeField value={code} onChangeText={setCode} autoFocus label={t("auth.authCode")} onComplete={(v) => void submit(v)} />
          </View>
        )}
        {feedback}
        <PrimaryButton label={t("auth.verify")} loading={busy} disabled={recovery ? !code.trim() : code.length < 6} onPress={() => void submit()} />
        <TextLink
          label={t(recovery ? "auth.useAuthenticator" : "auth.useRecovery")}
          onPress={() => {
            setRecovery((v) => !v);
            setCode("");
            setError("");
          }}
        />
      </AuthShell>
    );
  }

  if (mode === "reset") {
    return (
      <AuthShell
        title={t("auth.resetTitle")}
        subtitle={t("auth.resetIntro")}
        onBack={() => switchMode("signIn")}
        footer={<TextLink label={t("auth.backToSignIn")} muted onPress={() => switchMode("signIn")} />}
      >
        {emailField}
        {feedback}
        <PrimaryButton label={t("auth.sendReset")} loading={busy} disabled={!email.includes("@")} onPress={() => void submit()} />
      </AuthShell>
    );
  }

  const socialBlock = (
    <>
      {social?.providers.length ? (
        <SocialButtons providers={social.providers} running={socialBusy} disabled={busy} onPress={(provider) => void signInWithProvider(provider)} />
      ) : null}
      {socialBusy === "github" || socialBusy === "google" ? (
        // Sign-in continues in the system browser; it returns via zekra://.
        <View style={{ alignItems: "center", gap: 2 }}>
          <AppText variant="meta" style={{ textAlign: "center" }}>
            {t("social.inBrowser", { provider: PROVIDER_NAME[socialBusy] })}
          </AppText>
          <TextLink label={t("social.cancelBrowser")} onPress={cancelBrowserSignIn} />
        </View>
      ) : null}
    </>
  );

  if (mode === "register") {
    return (
      <AuthShell
        title={t("auth.createAccount")}
        subtitle={t("auth.intro")}
        onBack={() => switchMode("signIn")}
        footer={<SwitchLine prompt={t("auth.haveAccountPrompt")} action={t("auth.signInLink")} onPress={() => switchMode("signIn")} />}
      >
        <Field label={t("auth.name")} value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" />
        {emailField}
        <PasswordField label={t("auth.password")} value={password} onChangeText={setPassword} isNew />
        <StrengthMeter score={passwordScore(password)} caption={t("auth.strengthHint")} />
        {feedback}
        <PrimaryButton
          label={t("auth.signUp")}
          loading={busy}
          disabled={!email.includes("@") || password.length < 8 || !name.trim()}
          onPress={() => void submit()}
        />
        {socialBlock}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.signIn")}
      subtitle={t("auth.intro")}
      footer={
        <>
          <SwitchLine prompt={t("auth.noAccountPrompt")} action={t("auth.createOne")} onPress={() => switchMode("register")} />
          {/* Language before sign-in: Settings is not reachable yet. */}
          <LanguageLink />
        </>
      }
    >
      {emailField}
      <PasswordField
        label={t("auth.password")}
        labelAction={<TextLink label={t("auth.forgot")} compact onPress={() => switchMode("reset")} />}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
      />
      {feedback}
      <PrimaryButton
        label={t("auth.signIn")}
        loading={busy}
        disabled={!email.includes("@") || !password || !!socialBusy}
        onPress={() => void submit()}
      />
      {socialBlock}
    </AuthShell>
  );
}

/** The centred sign-in column — Health Debug's desktop sign-in: the mark, a
 *  title and one line under it, the form, then the footer links. Every step
 *  (sign in, create account, reset, two-factor) uses it. */
function AuthShell({ title, subtitle, onBack, footer, children }: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const { Back } = useChevrons();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: p.bg, direction: isRtl ? "rtl" : "ltr" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.column}>
          <View style={styles.hero}>
            <ZekraMark size={40} tight />
            <AppText style={{ fontFamily: fonts.semibold, fontSize: 26, lineHeight: 34, color: p.ink, textAlign: "center" }}>{title}</AppText>
            {subtitle ? (
              <AppText style={{ fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: p.muted, textAlign: "center" }}>{subtitle}</AppText>
            ) : null}
          </View>
          {children}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </ScrollView>
      {onBack ? (
        <View style={[styles.back, { top: insets.top + 6 }]}>
          <IconButton label={t("kit.back")} onPress={onBack}>
            <Back size={22} color={p.ink} strokeWidth={1.8} />
          </IconButton>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** A field label, with an optional action at its end ("Forgot password?"). */
function FieldLabel({ label, action }: { label: string; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 }}>
      <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 20, color: p.muted }}>{label}</AppText>
      {action}
    </View>
  );
}

/** A quiet text link: the accent, or muted. `compact` drops the 44pt height
 *  (it sits on a label row, whose own height is the target). */
function TextLink({ label, onPress, muted, compact }: { label: string; onPress: () => void; muted?: boolean; compact?: boolean }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={compact ? 12 : 0} style={compact ? null : styles.link}>
      <AppText style={{ fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 21, color: muted ? p.muted : p.action, textAlign: "center" }}>{label}</AppText>
    </Pressable>
  );
}

/** The current language, opening the language list (more languages are coming). */
function LanguageLink() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t("settings.language")} onPress={() => setOpen(true)} style={[styles.link, { flexDirection: "row", gap: 7 }]}>
        <Globe size={16} color={p.muted} strokeWidth={1.7} />
        <AppText style={{ fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 21, color: p.muted }}>{languageName(locale)}</AppText>
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("settings.language")}>
        <View style={{ paddingHorizontal: metrics.padX, paddingBottom: 8 }}>
          <LanguageList onPicked={() => setOpen(false)} />
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 },
  column: { width: "100%", maxWidth: 400, alignSelf: "center", gap: 16 },
  hero: { alignItems: "center", gap: 10, marginBottom: 10 },
  footer: { alignItems: "center", marginTop: 6 },
  back: { position: "absolute", start: 12 },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  switchLine: { minHeight: 44, alignItems: "center", justifyContent: "center" },
});
