import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";

import { toast } from "@/components/kit";
import { AppText, Row, Segmented } from "@/components/ui";
import { KIND_KEY, kindIcon } from "@/features/security/app-lock-gate";
import { confirmOwner, useBiometricInfo } from "@/features/security/biometrics";
import { LOCK_AFTER, type LockAfter } from "@/features/security/lock-core";
import { useAppLock } from "@/features/security/lock-store";
import { SettingsLabel, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

// Settings → Security: the biometric app lock (src/features/security). Turning
// it on or off asks for Face ID / Touch ID / fingerprint first, so the switch
// only ever reflects a sensor that works for this user.
export default function SecurityScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const lock = useAppLock();
  const info = useBiometricInfo();
  const [busy, setBusy] = useState(false);
  const kind = info?.kind ?? "biometrics";
  const label = t(KIND_KEY[kind]);
  const Icon = kindIcon(kind);
  const on = lock.settings.enabled;
  const ready = info?.availability === "ready";

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const decision = await confirmOwner(t(next ? "security.confirmOn" : "security.confirmOff", { kind: label }), t("common.cancel"));
      if (decision === "proceed") {
        await lock.setEnabled(next);
        if (next) toast(t("security.enabledToast", { kind: label }), "ok");
      } else if (decision === "failed") {
        toast(t("security.failed"), "danger");
      }
    } finally {
      setBusy(false);
    }
  };

  const body =
    info?.availability === "noHardware" ? t("security.noHardware")
    : info?.availability === "notEnrolled" ? t("security.notEnrolled", { kind: label })
    : t("security.unlockBody", { kind: label });

  return (
    <SettingsPage section="security">
      <Row style={{ gap: 0, paddingVertical: 0 }}>
        <View style={styles.row}>
          <Icon color={on ? p.action : p.muted} size={20} strokeWidth={1.7} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="rowTitle">{t("security.unlockWith", { kind: label })}</AppText>
            <AppText variant="meta">{body}</AppText>
          </View>
          <Switch
            accessibilityLabel={t("security.unlockWith", { kind: label })}
            value={on}
            // Off stays reachable even when the sensor went away; on needs one set up.
            disabled={busy || info === null || (!on && !ready)}
            onValueChange={(v) => void toggle(v)}
            trackColor={{ false: p.soft, true: p.action }}
            ios_backgroundColor={p.soft}
          />
        </View>
      </Row>
      {on ? (
        <>
          <Row>
            <SettingsLabel title={t("security.requireAfter")} body={t("security.requireAfterBody")} />
            <Segmented<`${LockAfter}`>
              value={`${lock.settings.after}`}
              onChange={(v) => void lock.setAfter(Number(v) as LockAfter)}
              options={LOCK_AFTER.map((after) => ({ value: `${after}` as `${LockAfter}`, label: t(`security.after.${after}`) }))}
            />
          </Row>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: 14, lineHeight: 22, color: p.muted }}>{t("security.passcodeNote", { kind: label })}</AppText>
          </Row>
        </>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 62, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
});
