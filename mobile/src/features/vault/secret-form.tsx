import { Eye, EyeOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { BottomSheet, ErrorLine, FilterStrip, TextButton, toast } from "@/components/kit";
import { AppText, Field, IconButton, PrimaryButton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

import { vaultApi } from "./api";
import { ltrRun } from "./kind-icon";
import { isDeniedStatus, isMultilineKind, isSecretKind, maskValue, SECRET_KINDS, validateSecretName, type SecretKind } from "./vault-core";

export type FormTarget = { name: string; kind: string } | null;

// Secret names and values are machine strings: always LTR, left-aligned, mono,
// and never touched by autocorrect, autofill, or the keyboard's learning.
const MACHINE_INPUT = {
  autoCapitalize: "none",
  autoCorrect: false,
  spellCheck: false,
  autoComplete: "off",
  importantForAutofill: "no",
  textContentType: "none",
} as const;

/**
 * Add a secret, or replace the value of an existing one (the same name
 * upserts). Updating pre-fills the name (locked) and kind and asks only for a
 * new value — the old value is never loaded into the form.
 */
export function SecretForm({ target, namespace, onClose, onSaved }: {
  target: FormTarget;
  namespace: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const updating = !!target?.name;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("generic");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open; wipe the value on close so it does not linger.
  useEffect(() => {
    setName(target?.name ?? "");
    setKind(target?.kind && target.kind.trim() ? target.kind : "generic");
    setValue("");
    setVisible(false);
    setTouched(false);
    setAttempted(false);
    setError(null);
  }, [target]);

  const check = validateSecretName(name);
  const nameError = touched && !check.ok ? t(`vault.name.${check.reason}`) : null;
  const multiline = isMultilineKind(kind);

  // An auto-captured kind (aws_key, jwt, …) is kept as-is on update; the
  // chips offer the manual kinds plus that one.
  const kinds: string[] = isSecretKind(kind) ? [...SECRET_KINDS] : [...SECRET_KINDS, kind];

  async function save() {
    setTouched(true);
    setAttempted(true);
    if (!token || !check.ok || !value) return;
    setBusy(true);
    setError(null);
    try {
      await vaultApi.put(token, { namespace, name: check.name, value, kind });
      setValue("");
      toast(t(updating ? "vault.replaced" : "vault.added"), "ok");
      onSaved(check.name);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && isDeniedStatus(caught.status)) setError(t("common.readOnly"));
      else if (caught instanceof ApiError && caught.status === 0) setError(t("kit.offline"));
      else setError(caught instanceof ApiError && caught.message ? caught.message : t("vault.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const ltrInput = { fontFamily: fonts.mono, fontSize: 13.5, textAlign: "left", writingDirection: "ltr" } as const;

  return (
    <BottomSheet
      open={target !== null}
      onClose={onClose}
      title={t(updating ? "vault.form.updateTitle" : "vault.form.addTitle")}
      subtitle={t("vault.form.storedIn", { ns: ltrRun(namespace) })}
      maxHeight={0.92}
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: metrics.padX, paddingBottom: 12, gap: 16 }}>
          <View style={{ gap: 6 }}>
            <Field
              {...MACHINE_INPUT}
              label={t("vault.form.name")}
              value={name}
              onChangeText={setName}
              onBlur={() => setTouched(true)}
              editable={!updating}
              autoFocus={!updating}
              placeholder="OPENAI_API_KEY"
              maxLength={200}
              style={[ltrInput, updating && { color: p.muted }]}
            />
            {nameError ? <ErrorLine text={nameError} /> : null}
            {nameError && !check.ok && check.suggestion ? (
              <View style={{ alignSelf: "flex-start" }}>
                <TextButton label={t("vault.name.use", { name: ltrRun(check.suggestion) })} onPress={() => setName(check.suggestion ?? "")} />
              </View>
            ) : null}
          </View>

          <View style={{ gap: 7 }}>
            <AppText variant="micro">{t("vault.form.kind").toUpperCase()}</AppText>
            <FilterStrip<string>
              inset={false}
              value={kind}
              onChange={setKind}
              options={kinds.map((k) => ({ value: k, label: isSecretKind(k) ? t(`vault.kind.${k as SecretKind}`) : ltrRun(k) }))}
            />
          </View>

          <View style={{ gap: 7 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field
                  {...MACHINE_INPUT}
                  label={t("vault.form.value")}
                  value={value}
                  onChangeText={setValue}
                  autoFocus={updating}
                  // RN cannot mask a multiline input, so PEM blocks and .env
                  // dumps are entered in the clear; single-line values are
                  // masked with a show/hide toggle.
                  multiline={multiline}
                  secureTextEntry={!multiline && !visible}
                  placeholder={multiline ? (kind === "env" ? "KEY=value" : "-----BEGIN PRIVATE KEY-----") : "sk-…"}
                  style={[ltrInput, multiline && { minHeight: 140 }]}
                />
              </View>
              {!multiline ? (
                <IconButton label={t(visible ? "vault.form.hideValue" : "vault.form.show")} onPress={() => setVisible((v) => !v)}>
                  {visible ? <EyeOff size={18} color={p.muted} strokeWidth={1.6} /> : <Eye size={18} color={p.muted} strokeWidth={1.6} />}
                </IconButton>
              ) : null}
            </View>
            {updating ? <AppText variant="meta">{t("vault.form.replaceHint")}</AppText> : null}
            {value ? <AppText variant="mono">{t("vault.form.preview", { hint: ltrRun(maskValue(value)) })}</AppText> : null}
            {attempted && !value ? <ErrorLine text={t("vault.form.valueRequired")} /> : null}
          </View>

          {error ? <ErrorLine text={error} /> : null}
          <PrimaryButton label={t("vault.form.save")} loading={busy} disabled={!token} onPress={() => void save()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
