import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Copy, Eye, EyeOff, LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import {
  AwaitNote,
  BottomSheet,
  Chip,
  ErrorLine,
  ListItem,
  Meta,
  QueryStatus,
  SheetDivider,
  SheetItem,
  Spinner,
  TextButton,
  Tile,
  toast,
  useQueryRefresh,
} from "@/components/kit";
import { AppText, Field, IconButton, PrimaryButton, Row } from "@/components/ui";
import { ApiError, type Brain } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

import { vaultApi, vaultKey, type SecretMeta } from "./api";
import { copySecret } from "./clipboard-guard";
import { confirmIdentity } from "./device-auth";
import { KindIcon, ltrRun } from "./kind-icon";
import { SecretForm, type FormTarget } from "./secret-form";
import { useRevealed, type Revealed } from "./use-revealed";
import { displayHint, filterSecrets, FILTER_THRESHOLD, isDeniedStatus, kindLabelKey, relativeAgo } from "./vault-core";

/**
 * A brain's secrets vault (MH-370): the "Vault" tab of app/brain/[ns].tsx.
 *
 * Security model, in order:
 *  - The list is metadata only (masked hints). Values are fetched one at a
 *    time on Reveal / Copy, which the server allows only with WRITE access.
 *  - Every reveal first asks the device owner to confirm (biometrics or
 *    passcode) — see device-auth.ts.
 *  - A revealed value lives in component state only (not the query cache, not
 *    logs), hides after 30s, and hides when the app leaves the foreground.
 *  - A copied value is wiped from the clipboard after 60s where that can be
 *    done safely — see clipboard-guard.ts.
 */
export function BrainVault({ brain }: { brain: Brain }) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const client = useQueryClient();
  const ns = brain.namespace;
  const canWrite = brain.canWrite;

  const secrets = useQuery({
    queryKey: vaultKey(token, ns),
    queryFn: () => vaultApi.list(token!, ns),
    enabled: !!token,
  });
  const refresh = useQueryRefresh(secrets);
  const revealed = useRevealed();

  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<SecretMeta | null>(null);
  const [form, setForm] = useState<FormTarget>(null);

  const list = useMemo(() => secrets.data?.secrets ?? [], [secrets.data]);
  const visible = useMemo(() => filterSecrets(list, filter), [list, filter]);

  // A new brain gets a clean slate.
  const { hideAll } = revealed;
  useEffect(() => {
    hideAll();
    setRowError({});
    setFilter("");
  }, [ns, hideAll]);

  const invalidate = () => client.invalidateQueries({ queryKey: vaultKey(token, ns) });

  function setError(name: string, message: string | null) {
    setRowError((prev) => {
      const next = { ...prev };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }

  /** Device check, then POST reveal. Resolves to the value, or null when the
   *  user cancelled, was refused, or the app moved on meanwhile. */
  async function fetchValue(s: SecretMeta): Promise<{ value: string; epoch: number } | null> {
    if (!token) return null;
    if (!canWrite) {
      setError(s.name, t("vault.denied"));
      return null;
    }
    const epoch = revealed.begin();
    setBusy(s.name);
    setError(s.name, null);
    try {
      revealed.setPrompting(true);
      const gate = await confirmIdentity(t("vault.authPrompt", { name: s.name }), t("common.cancel"));
      revealed.setPrompting(false);
      if (gate === "cancel") return null;
      if (gate === "failed") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(s.name, t("vault.authFailed"));
        return null;
      }
      const answer = await vaultApi.reveal(token, s.namespace, s.name);
      return { value: answer.value, epoch };
    } catch (caught) {
      // Never surface or log the payload — only the status decides the message.
      const status = caught instanceof ApiError ? caught.status : undefined;
      setError(s.name, isDeniedStatus(status) ? t("vault.denied") : status === 0 ? t("kit.offline") : t("vault.revealFailed"));
      // Gone on the server (deleted elsewhere): refresh the list.
      if (status === 404) void invalidate();
      return null;
    } finally {
      revealed.setPrompting(false);
      setBusy(null);
    }
  }

  async function reveal(s: SecretMeta) {
    const got = await fetchValue(s);
    if (got) revealed.show(s.name, got.value, got.epoch);
  }

  async function copy(value: string) {
    try {
      await copySecret(value);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast(t("vault.copied"), "ok");
    } catch {
      toast(t("kit.error"), "danger");
    }
  }

  /** Copy from the menu: reuse a value already on screen, else reveal (with the
   *  device check) and copy without ever displaying it. */
  async function copyValue(s: SecretMeta) {
    const shown = revealed.values[s.name];
    if (shown) return copy(shown.value);
    const got = await fetchValue(s);
    if (got && got.epoch === revealed.begin()) await copy(got.value);
  }

  function confirmDelete(s: SecretMeta) {
    Alert.alert(t("vault.deleteTitle", { name: s.name }), t("vault.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          revealed.hide(s.name);
          try {
            await vaultApi.remove(token!, s.namespace, s.name);
            toast(t("vault.deleted"), "ok");
            void invalidate();
          } catch (caught) {
            const status = caught instanceof ApiError ? caught.status : undefined;
            toast(isDeniedStatus(status) ? t("common.readOnly") : t("vault.deleteFailed"), "danger");
          }
        },
      },
    ]);
  }

  function onPressRow(s: SecretMeta) {
    if (busy) return;
    if (revealed.values[s.name]) revealed.hide(s.name);
    else void reveal(s);
  }

  function onLongPressRow(s: SecretMeta) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMenu(s);
  }

  /** Close the menu, then act once the sheet has slid away. */
  function fromMenu(action: (s: SecretMeta) => void) {
    const s = menu;
    setMenu(null);
    if (s) setTimeout(() => action(s), 350); // after the 220ms slide-out + Modal unmount (iOS drops alerts/prompts raised over a closing Modal)
  }

  const menuShown = menu ? revealed.values[menu.name] : undefined;

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: metrics.gap, paddingBottom: metrics.gap * 2 }}
      >
        <Row>
          <AppText style={{ fontFamily: fonts.light, fontSize: 12.5, lineHeight: 20, color: p.muted }}>{t("vault.intro")}</AppText>
          {canWrite ? (
            <PrimaryButton
              label={t("vault.new")}
              icon={<Plus size={17} color={p.onAction} strokeWidth={1.8} />}
              onPress={() => setForm({ name: "", kind: "generic" })}
            />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <LockKeyhole size={16} color={p.gold} strokeWidth={1.6} />
              <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19, color: p.body }}>{t("vault.readOnlyNote")}</AppText>
            </View>
          )}
        </Row>

        {list.length > FILTER_THRESHOLD ? (
          <Row>
            <Field
              accessibilityLabel={t("vault.filter")}
              value={filter}
              onChangeText={setFilter}
              placeholder={t("vault.filterPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            <AppText variant="micro">
              {(filter.trim() ? t("vault.countFiltered", { n: visible.length, total: list.length }) : t("vault.count", { n: list.length })).toUpperCase()}
            </AppText>
          </Row>
        ) : null}

        <QueryStatus q={secrets} empty={list.length === 0} emptyText={t("vault.emptyList")} lines={3} />
        {!secrets.isPending && !secrets.error && list.length === 0 && canWrite ? (
          <Row>
            <AppText variant="meta" style={{ lineHeight: 18 }}>{t("vault.emptyHint")}</AppText>
          </Row>
        ) : null}

        {list.length > 0 && visible.length === 0 ? (
          <Row>
            <AwaitNote text={t("vault.noMatch")} />
          </Row>
        ) : null}

        {visible.length > 0 ? (
          <Row style={{ paddingVertical: 0, gap: 0 }}>
            {visible.map((s, i) => (
              <SecretItem
                key={s.name}
                s={s}
                last={i === visible.length - 1}
                canWrite={canWrite}
                shown={revealed.values[s.name]}
                busy={busy === s.name}
                error={rowError[s.name]}
                onPress={() => onPressRow(s)}
                onLongPress={() => onLongPressRow(s)}
                onCopy={(v) => void copy(v)}
                onHide={() => revealed.hide(s.name)}
              />
            ))}
          </Row>
        ) : null}
      </ScrollView>

      <BottomSheet open={menu !== null} onClose={() => setMenu(null)} title={menu ? ltrRun(menu.name) : undefined} subtitle={t("vault.actions")}>
        {!canWrite ? (
          <View style={{ paddingHorizontal: metrics.padX, paddingBottom: 8 }}>
            <AwaitNote text={t("vault.readOnlyNote")} />
          </View>
        ) : null}
        <SheetItem
          icon={menuShown ? <EyeOff size={18} color={p.ink} strokeWidth={1.6} /> : <Eye size={18} color={p.ink} strokeWidth={1.6} />}
          label={t(menuShown ? "vault.hide" : "vault.reveal")}
          disabled={!canWrite}
          onPress={() => fromMenu((s) => (revealed.values[s.name] ? revealed.hide(s.name) : void reveal(s)))}
        />
        <SheetItem
          icon={<Copy size={18} color={p.ink} strokeWidth={1.6} />}
          label={t("vault.copyValue")}
          detail={t("vault.copyValueDetail")}
          disabled={!canWrite}
          onPress={() => fromMenu((s) => void copyValue(s))}
        />
        <SheetDivider />
        <SheetItem
          icon={<Pencil size={18} color={p.ink} strokeWidth={1.6} />}
          label={t("vault.update")}
          disabled={!canWrite}
          onPress={() => fromMenu((s) => setForm({ name: s.name, kind: s.kind || "generic" }))}
        />
        <SheetItem
          icon={<Trash2 size={18} color={p.danger} strokeWidth={1.6} />}
          label={t("vault.delete")}
          tone="danger"
          disabled={!canWrite}
          onPress={() => fromMenu(confirmDelete)}
        />
      </BottomSheet>

      <SecretForm
        target={form}
        namespace={ns}
        onClose={() => setForm(null)}
        onSaved={(name) => {
          // The shown value (if any) is stale now.
          revealed.hide(name);
          setError(name, null);
          void invalidate();
        }}
      />
    </>
  );
}

function SecretItem({ s, last, canWrite, shown, busy, error, onPress, onLongPress, onCopy, onHide }: {
  s: SecretMeta;
  last: boolean;
  canWrite: boolean;
  shown?: Revealed;
  busy: boolean;
  error?: string;
  onPress: () => void;
  onLongPress: () => void;
  onCopy: (value: string) => void;
  onHide: () => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const labelKey = kindLabelKey(s.kind);
  const ago = relativeAgo(s.updatedAt);
  const when = ago ? t(`vault.time.${ago.unit}`, { n: ago.n }) : null;

  return (
    <ListItem
      last={last}
      alignTop
      onPress={onPress}
      onLongPress={onLongPress}
      leading={
        <Tile size={38} gold={!!shown}>
          <KindIcon kind={s.kind} color={shown ? p.gold : p.muted} />
        </Tile>
      }
      trailing={
        busy ? (
          <View style={{ width: metrics.touch, height: metrics.touch, alignItems: "center", justifyContent: "center" }}>
            <Spinner />
          </View>
        ) : canWrite ? (
          <IconButton label={t(shown ? "vault.hide" : "vault.reveal")} onPress={onPress}>
            {shown ? <EyeOff size={18} color={p.gold} strokeWidth={1.6} /> : <Eye size={18} color={p.muted} strokeWidth={1.6} />}
          </IconButton>
        ) : null
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <AppText numberOfLines={1} style={{ fontFamily: fonts.monoMedium, fontSize: 13.5, color: p.ink, flexShrink: 1 }}>
          {ltrRun(s.name)}
        </AppText>
        <Chip label={labelKey ? t(labelKey) : ltrRun(s.kind)} tone={shown ? "gold" : "muted"} />
      </View>

      {shown ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          {/* The value itself: selectable, so no isolate marks (they would be
              copied along with it). */}
          <View style={{ borderWidth: 1, borderColor: `${p.gold}66`, backgroundColor: `${p.gold}0F`, borderRadius: metrics.radius.control, paddingHorizontal: 12, paddingVertical: 10 }}>
            <AppText selectable style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 19, color: p.ink, textAlign: "left", writingDirection: "ltr" }}>
              {shown.value}
            </AppText>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Countdown until={shown.until} />
            <View style={{ flex: 1 }} />
            <TextButton label={t("vault.copy")} tone="action" onPress={() => onCopy(shown.value)} />
            <TextButton label={t("vault.hide")} muted onPress={onHide} />
          </View>
        </View>
      ) : (
        <AppText style={{ fontFamily: fonts.mono, fontSize: 12, color: p.muted, letterSpacing: 0.3 }}>{ltrRun(displayHint(s.hint))}</AppText>
      )}

      <Meta items={[s.createdBy ? t("vault.by", { who: ltrRun(s.createdBy) }) : null, when ? t("vault.updated", { when }) : null]} />
      {s.sourceRef ? (
        <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 11, color: p.muted }}>
          {t("vault.source", { ref: ltrRun(s.sourceRef) })}
        </AppText>
      ) : null}
      {error ? <ErrorLine text={error} /> : null}
    </ListItem>
  );
}

/** "Hides in 24s", ticking once a second while a value is on screen. */
function Countdown({ until }: { until: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return <AppText variant="micro">{t("vault.hidesIn", { s }).toUpperCase()}</AppText>;
}
