import { Mail, Undo2 } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { ErrorLine } from "@/components/kit";
import { AppText, CodeField, Field, PrimaryButton, SecondaryButton } from "@/components/ui";
import { ApiError, zekraApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

// Cancelling a scheduled deletion. Scheduling signs the account out everywhere
// (this device too), so this works without a session: the API mails a 6-digit
// code to the address when a deletion is pending for it
// (POST /api/me/delete/cancel/code — the same answer either way) and
// POST /api/me/delete/cancel {email, code} withdraws it. A code works for every
// account, with or without a password. internal/account/deletion.go.
export function CancelDeletionForm({ initialEmail = "", onCancelled }: { initialEmail?: string; onCancelled?: () => void }) {
  const p = usePalette();
  const { t, locale } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState<"send" | "cancel" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function send() {
    setBusy("send");
    setError("");
    try {
      await zekraApi.cancelDeleteCode(email.trim(), locale);
      setSentTo(email.trim());
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? t("social.tooMany") : t("deletion.cancelFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(value = code) {
    if (value.length !== 6) return;
    setBusy("cancel");
    setError("");
    try {
      await zekraApi.cancelDelete(sentTo || email.trim(), { code: value });
      setDone(true);
      onCancelled?.();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? t("social.tooMany") : t("deletion.cancelFailed"));
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <View style={{ width: 7, height: 7, backgroundColor: p.ok }} />
        <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22, color: p.ok }}>{t("deletion.cancelled")}</AppText>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Field
        label={t("account.email")}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setSentTo("");
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        ltr
        icon={<Mail size={17} color={p.muted} strokeWidth={1.6} />}
      />
      {sentTo ? (
        <>
          <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: locale === "ar" ? 27 : 23, color: p.body }}>
            {t("deletion.cancelCodeSent", { email: sentTo })}
          </AppText>
          <CodeField label={t("deletion.code")} value={code} onChangeText={setCode} onComplete={(v) => void cancel(v)} />
        </>
      ) : null}
      {error ? <ErrorLine text={error} /> : null}
      {sentTo ? (
        <>
          <PrimaryButton
            label={t("deletion.cancelSubmit")}
            icon={<Undo2 size={18} color={p.onAction} strokeWidth={1.6} />}
            loading={busy === "cancel"}
            disabled={code.length !== 6 || busy !== null}
            onPress={() => void cancel()}
          />
          <SecondaryButton label={t("deletion.resendCode")} loading={busy === "send"} disabled={busy !== null} onPress={() => void send()} />
        </>
      ) : (
        <SecondaryButton
          label={t("deletion.sendCode")}
          icon={<Mail size={18} color={p.ink} strokeWidth={1.6} />}
          loading={busy === "send"}
          disabled={!email.includes("@") || busy !== null}
          onPress={() => void send()}
        />
      )}
    </View>
  );
}
