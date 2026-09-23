import { Bell, BellOff } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, Switch, View } from "react-native";

import { TextButton, toast } from "@/components/kit";
import { AppText } from "@/components/ui";
import { disablePush, enablePush, pushStatus, sendTestPush } from "@/features/push/push";
import type { PushState } from "@/features/push/push-core";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

/**
 * The notifications setting (MH-373): on / off / blocked by the OS / not in
 * this build. The only place the app asks for notification permission.
 *
 * Renders one row in the settings screen's row style; place it inside a
 * `<Row style={{ gap: 0, paddingVertical: 0 }}>` group.
 */
export function NotificationSettingsRow() {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setState(await pushStatus()), []);

  useEffect(() => {
    void refresh();
    // Coming back from the OS settings screen may have changed the answer.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const toggle = async (next: boolean) => {
    if (!token || busy) return;
    setBusy(true);
    try {
      const result = next ? await enablePush(token) : await disablePush(token);
      if (next && result === "on") toast(t("push.enabledToast"), "ok");
      if (next && result === "denied") toast(t("push.deniedToast"));
    } catch {
      toast(t("push.failed"), "danger");
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const test = async () => {
    if (!token) return;
    try {
      const res = await sendTestPush(token);
      toast(t("push.testSent", { count: res.sent }), res.sent > 0 ? "ok" : undefined);
    } catch {
      toast(t("push.testFailed"), "danger");
    }
  };

  const on = state === "on";
  const body =
    state === "on" ? t("push.onBody")
    : state === "denied" ? t("push.deniedBody")
    : state === "unavailable" ? t("push.unavailable")
    : t("push.offBody");
  const Icon = on ? Bell : BellOff;

  return (
    <View style={styles.row}>
      <Icon color={on ? p.action : p.muted} size={20} strokeWidth={1.7} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="rowTitle">{t("push.title")}</AppText>
        <AppText variant="meta">{body}</AppText>
        {on ? (
          <View style={{ alignSelf: "flex-start", marginStart: -8 }}>
            <TextButton label={t("push.sendTest")} onPress={() => void test()} />
          </View>
        ) : null}
      </View>
      {state === "denied" ? (
        <TextButton label={t("push.openSettings")} onPress={() => void Linking.openSettings().catch(() => {})} />
      ) : (
        <Switch
          accessibilityLabel={t("push.title")}
          value={on}
          disabled={busy || !token || state === null || state === "unavailable"}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ false: p.soft, true: p.action }}
          ios_backgroundColor={p.soft}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 62, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
});
