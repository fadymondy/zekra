import { ImagePlus, Send, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { BottomSheet, ErrorLine, toast } from "@/components/kit";
import { AppText, Field, PrimaryButton, Segmented, SecondaryButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

import { pickAttachment, submitFeedback, type Attachment } from "./client";
import { diagnostics, getCurrentRoute, getReporterEmail } from "./diagnostics";
import { crashTitle, TITLE_MAX, validEmail, type FeedbackKind, type ReportedError } from "./mahaam-core";

export type ReportRequest = {
  kind?: FeedbackKind;
  error?: ReportedError;
  /** A capture of the screen the report was started from (shake to report); removable. */
  screenshot?: Attachment;
};

/**
 * "Report a problem" / "Send feedback": files an issue on Zekra's Mahaam board
 * through the public feedback intake. Self-contained (no auth or query context),
 * so the root ErrorBoundary can render it outside the app's providers.
 */
export function ReportSheet({ open, onClose, request }: { open: boolean; onClose: () => void; request: ReportRequest }) {
  const p = usePalette();
  const { t } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [withDiagnostics, setWithDiagnostics] = useState(true);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A fresh form each time it opens, pre-filled from the request (a crash → its title).
  useEffect(() => {
    if (!open) return;
    setKind(request.kind ?? "bug");
    setTitle(request.error ? crashTitle(request.error) : "");
    setDescription("");
    setEmail(getReporterEmail());
    setWithDiagnostics(true);
    setAttachment(request.screenshot ?? null);
    setError(null);
    setBusy(false);
  }, [open, request]);

  const counts = open ? diagnostics.counts() : { errors: 0, requests: 0, failed: 0 };

  async function attach() {
    setError(null);
    try {
      const picked = await pickAttachment();
      if (!picked) return;
      if ("error" in picked) setError(t(picked.error === "type" ? "mahaam.imageType" : "mahaam.imageSize"));
      else setAttachment(picked.attachment);
    } catch {
      setError(t("mahaam.imageType"));
    }
  }

  async function send() {
    if (!title.trim()) return setError(t("mahaam.titleRequired"));
    if (email.trim() && !validEmail(email)) return setError(t("mahaam.emailInvalid"));
    setError(null);
    setBusy(true);
    const outcome = await submitFeedback({
      draft: { kind, title, description, email: email.trim() || undefined, route: getCurrentRoute(), error: request.error },
      includeDiagnostics: withDiagnostics,
      attachment,
    });
    setBusy(false);
    if (outcome.ok) {
      toast(outcome.key ? t("mahaam.sent", { key: outcome.key }) : t("mahaam.sentNoKey"), "ok");
      onClose();
      return;
    }
    setError(
      outcome.reason === "unavailable" ? t("mahaam.unavailable")
        : outcome.reason === "rate" ? t("mahaam.rate")
        : outcome.reason === "invalid" && outcome.message ? outcome.message
        : t("mahaam.failed"),
    );
  }

  const optional = (label: string) => `${label} · ${t("mahaam.optional")}`;
  const sheetTitle = kind === "bug" ? t("mahaam.report") : t("mahaam.feedback");

  return (
    <BottomSheet open={open} onClose={busy ? () => {} : onClose} title={sheetTitle} subtitle={t("mahaam.subtitle")} maxHeight={0.92}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <Segmented<FeedbackKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "bug", label: t("mahaam.kind.bug") },
              { value: "idea", label: t("mahaam.kind.idea") },
              { value: "question", label: t("mahaam.kind.question") },
            ]}
          />

          <Field
            label={t("mahaam.title")}
            value={title}
            onChangeText={setTitle}
            maxLength={TITLE_MAX}
            placeholder={t(`mahaam.titlePlaceholder.${kind}`)}
            returnKeyType="next"
          />

          <Field
            label={optional(t("mahaam.details"))}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={5000}
            placeholder={t("mahaam.detailsPlaceholder")}
          />

          <Field
            label={optional(t("mahaam.email"))}
            value={email}
            onChangeText={setEmail}
            ltr
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            maxLength={200}
            placeholder="name@example.com"
          />

          {attachment ? (
            <View style={[styles.shot, { borderColor: p.line, backgroundColor: p.card }]}>
              <Image source={{ uri: attachment.uri }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
              <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: p.ink }}>{t(attachment.source === "screen" ? "mahaam.screenAttached" : "mahaam.imageAttached")}</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel={t("mahaam.removeImage")} hitSlop={10} onPress={() => setAttachment(null)}>
                <X size={18} color={p.muted} strokeWidth={1.8} />
              </Pressable>
            </View>
          ) : (
            <SecondaryButton label={t("mahaam.attach")} icon={<ImagePlus size={17} color={p.ink} strokeWidth={1.6} />} onPress={() => void attach()} />
          )}

          <View style={styles.toggle}>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 21, color: p.ink }}>{t("mahaam.diagnostics")}</AppText>
              <AppText style={{ fontFamily: fonts.light, fontSize: 12, lineHeight: 19, color: p.muted }}>
                {t("mahaam.diagnosticsHint", { errors: counts.errors, failed: counts.failed })}
              </AppText>
            </View>
            <Switch value={withDiagnostics} onValueChange={setWithDiagnostics} trackColor={{ true: p.action }} accessibilityLabel={t("mahaam.diagnostics")} />
          </View>

          {request.error ? <AppText style={{ fontFamily: fonts.light, fontSize: 12, lineHeight: 19, color: p.muted }}>{t("mahaam.crashAttached")}</AppText> : null}

          {error ? <ErrorLine text={error} /> : null}

          <PrimaryButton label={t("mahaam.send")} icon={<Send size={17} color={p.onAction} strokeWidth={1.8} />} loading={busy} onPress={() => void send()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: metrics.padX, paddingTop: 4, paddingBottom: 16, gap: 14 },
  shot: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: metrics.radius.control, padding: 8 },
  thumb: { width: 44, height: 44, borderRadius: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12 },
});
