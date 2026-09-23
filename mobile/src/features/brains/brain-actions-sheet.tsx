import { router } from "expo-router";
import { Download, KeyRound, NotebookText, Presentation, SquareArrowOutUpRight, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { BottomSheet, ErrorLine, SheetDivider, SheetItem, Spinner, toast } from "@/components/kit";
import { AppText, Field, SecondaryButton } from "@/components/ui";
import { brainsApi, exportBrain, useInvalidateBrains } from "@/features/brains/brain-data";
import { brainName, canDelete, formatCount, ltr, type BrainListItem } from "@/features/brains/brains-core";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

type Tab = "notes" | "presentations" | "vault";

/**
 * A brain's actions (long-press or ⋯ on a card): open it on a tab, export it
 * as NDJSON, or — admins and owners only — delete it after typing its
 * namespace, as on the web.
 */
export function BrainActionsSheet({ brain, onClose }: { brain: BrainListItem | null; onClose: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const invalidate = useInvalidateBrains();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the last brain while the sheet animates closed.
  const [shown, setShown] = useState<BrainListItem | null>(brain);

  useEffect(() => {
    if (brain) {
      setShown(brain);
      setConfirming(false);
      setTyped("");
      setError(null);
    }
  }, [brain]);

  const ns = shown?.namespace ?? "";
  const name = shown ? brainName(shown) : "";

  const open = (tab?: Tab) => {
    onClose();
    router.push({ pathname: "/brain/[ns]", params: tab ? { ns, tab } : { ns } });
  };

  async function doExport() {
    if (!token || exporting) return;
    setExporting(true);
    try {
      await exportBrain(token, ns, t("brains.menu.export"));
      onClose();
    } catch {
      toast(t("brains.export.failed"), "danger");
    } finally {
      setExporting(false);
    }
  }

  async function doDelete() {
    if (!token || typed !== ns || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await brainsApi.remove(token, ns);
      await invalidate();
      toast(t("brains.delete.done", { brain: ns, count: formatCount(res?.deleted ?? 0) }), "ok");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? t("brains.error.network") : err instanceof Error ? err.message : t("brains.error.network"));
    } finally {
      setBusy(false);
    }
  }

  const icon = (I: typeof Trash2, color = p.muted) => <I size={19} color={color} strokeWidth={1.6} />;

  return (
    <BottomSheet
      open={!!brain}
      onClose={onClose}
      title={confirming ? t("brains.delete.title") : name}
      subtitle={confirming ? undefined : ns !== name ? ns : undefined}
    >
      {confirming ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ paddingHorizontal: metrics.padX, paddingBottom: 12, gap: 14 }}>
            <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: 26, color: p.body }}>
              {t("brains.delete.description", { brain: ltr(ns) })}
            </AppText>
            <Field
              label={t("brains.delete.typeToConfirm", { brain: ltr(ns) })}
              value={typed}
              onChangeText={setTyped}
              placeholder={ns}
              ltr
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              style={{ fontFamily: fonts.mono, fontSize: 15.5 }}
            />
            {error ? <ErrorLine text={error} /> : null}
            <SecondaryButton
              tone="danger"
              label={t("brains.delete.submit")}
              icon={<Trash2 size={18} color={p.danger} strokeWidth={1.6} />}
              disabled={typed !== ns}
              loading={busy}
              onPress={() => void doDelete()}
            />
            <SecondaryButton label={t("common.cancel")} onPress={() => setConfirming(false)} />
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={{ paddingBottom: 6 }}>
          <SheetItem icon={icon(SquareArrowOutUpRight, p.gold)} label={t("brains.menu.open")} onPress={() => open()} />
          <SheetItem icon={icon(NotebookText)} label={t("brains.menu.notes")} onPress={() => open("notes")} />
          <SheetItem icon={icon(Presentation)} label={t("brains.menu.presentations")} onPress={() => open("presentations")} />
          <SheetItem icon={icon(KeyRound)} label={t("brains.menu.vault")} onPress={() => open("vault")} />
          <SheetDivider />
          <SheetItem
            icon={icon(Download)}
            label={t("brains.menu.export")}
            detail={exporting ? t("brains.export.preparing") : t("brains.menu.exportDetail")}
            disabled={exporting}
            trailing={exporting ? <Spinner /> : undefined}
            onPress={() => void doExport()}
          />
          {canDelete(shown?.role) ? (
            <SheetItem tone="danger" icon={icon(Trash2, p.danger)} label={t("brains.menu.delete")} onPress={() => setConfirming(true)} />
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}
