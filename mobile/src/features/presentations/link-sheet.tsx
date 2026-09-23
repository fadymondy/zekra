import { Copy, KeyRound, Share2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { AwaitNote, BottomSheet, ErrorLine, FilterStrip, toast } from "@/components/kit";
import { AppText, Field, PrimaryButton, SecondaryButton, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

import { presentationsApi } from "./api";
import { copyText, shareLink } from "./files";
import { useFormat } from "./parts";
import { EXPIRY_PRESETS, errorMessages } from "./presentations-core";
import type { PLocale, ShareCreated } from "./types";

export type LinkSheetMode = { mode: "new" } | { mode: "result"; created: ShareCreated };

/*
New share link (POST /api/presentations/{id}/share) and the one moment its
address is guaranteed visible. When the server cannot seal tokens
(`recoverable: false`) the address is never shown again, so the result says
so plainly and offers Copy / Share right there.
*/
export function LinkSheet({ state, onClose, docId, title, locales, defaultLocale, onCreated }: {
  state: LinkSheetMode | null;
  onClose: () => void;
  docId: string;
  title: string;
  /** Languages the document has content in (a link needs content). */
  locales: PLocale[];
  defaultLocale: PLocale;
  onCreated: (created: ShareCreated) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { token } = useAuth();
  const [label, setLabel] = useState("");
  const [loc, setLoc] = useState<PLocale>(defaultLocale);
  const [days, setDays] = useState("0");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ShareCreated | null>(null);

  const open = state !== null;
  useEffect(() => {
    if (!state) return;
    setErrors([]);
    setBusy(false);
    if (state.mode === "result") setResult(state.created);
    else {
      setResult(null);
      setLabel("");
      setDays("0");
      setLoc(locales.includes(defaultLocale) ? defaultLocale : locales[0] ?? "en");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const create = async () => {
    if (!token) return;
    setBusy(true);
    setErrors([]);
    try {
      const out = await presentationsApi.share(token, docId, { label: label.trim() || undefined, locale: loc, expires_in_days: Number(days) });
      setResult(out);
      onCreated(out);
    } catch (err) {
      setErrors(err instanceof ApiError ? errorMessages(err.payload, err.message) : [err instanceof Error ? err.message : t("kit.error")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={result ? t("presentations.share.created") : t("presentations.share.new")}
      subtitle={title}
      maxHeight={0.9}
    >
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {result ? (
          <LinkResult created={result} onDone={onClose} />
        ) : (
          <>
            <Field
              label={t("presentations.share.label")}
              value={label}
              onChangeText={setLabel}
              placeholder={t("presentations.share.labelPlaceholder")}
              maxLength={80}
            />
            {locales.length > 1 ? (
              <View style={{ gap: 7 }}>
                <AppText variant="micro">{t("presentations.share.language").toUpperCase()}</AppText>
                <Segmented<PLocale> value={loc} onChange={setLoc} options={locales.map((l) => ({ value: l, label: f.language(l) }))} />
              </View>
            ) : null}
            <View style={{ gap: 7 }}>
              <AppText variant="micro">{t("presentations.share.expires").toUpperCase()}</AppText>
              <FilterStrip<string>
                inset={false}
                value={days}
                onChange={setDays}
                options={EXPIRY_PRESETS.map((n) => ({ value: String(n), label: f.days(n) }))}
              />
            </View>
            {errors.map((m, i) => <ErrorLine key={i} text={m} />)}
            <PrimaryButton label={t("presentations.share.create")} loading={busy} onPress={() => void create()} />
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

/** The address of a link just made, with Copy / Share, and whether it can be shown again. */
function LinkResult({ created, onDone }: { created: ShareCreated; onDone: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <>
      <View style={[styles.url, { borderColor: p.gold, backgroundColor: `${p.gold}14` }]}>
        <AppText selectable style={{ fontFamily: fonts.mono, fontSize: 12.5, color: p.ink, writingDirection: "ltr", textAlign: "left" }}>
          {created.url}
        </AppText>
      </View>
      {created.recoverable ? (
        <AwaitNote text={t("presentations.share.recoverable")} />
      ) : (
        <View style={styles.once}>
          <KeyRound size={15} color={p.warn} strokeWidth={1.8} />
          <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, color: p.warn }}>{t("presentations.share.keep")}</AppText>
        </View>
      )}
      <View style={styles.actions}>
        <SecondaryButton
          style={{ flex: 1 }}
          label={t("presentations.share.copy")}
          icon={<Copy size={16} color={p.ink} strokeWidth={1.6} />}
          onPress={() => void copyText(created.url).then(() => toast(t("kit.copied"), "ok"))}
        />
        <SecondaryButton
          style={{ flex: 1 }}
          label={t("presentations.share.share")}
          icon={<Share2 size={16} color={p.ink} strokeWidth={1.6} />}
          onPress={() => void shareLink(created.url).catch(() => undefined)}
        />
      </View>
      <PrimaryButton label={t("presentations.done")} onPress={onDone} />
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: metrics.padX, paddingTop: 4, paddingBottom: 12, gap: 16 },
  url: { borderWidth: 1, borderRadius: metrics.radius.control, padding: 12 },
  once: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  actions: { flexDirection: "row", gap: 8 },
});
