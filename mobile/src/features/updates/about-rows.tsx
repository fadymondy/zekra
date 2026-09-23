import * as Application from "expo-application";
import { Download, GitBranch, Layers, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";

import { Spinner, toast } from "@/components/kit";
import { AppText, Row } from "@/components/ui";
import { SettingsItem } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";

import { checkNow, restartToUpdate } from "./controller";
import { patchDeployment, patchUnavailableReason } from "./patch";
import { useUpdates } from "./update-host";

/*
Settings → About → Updates: Check for updates (OTA + store), Restart to update
once an OTA update is ready, the native build, and the update channel (the
Patch deployment this binary follows + the OTA release running now).
*/
export function UpdatesAboutRows() {
  const { t } = useI18n();
  const s = useUpdates();
  const [busy, setBusy] = useState(false);
  if (Platform.OS === "web") return null;

  const reason = patchUnavailableReason();
  const deployment = patchDeployment();
  const checking = busy || s.ota.phase === "checking";
  const pct = s.ota.total ? Math.round(((s.ota.received ?? 0) / s.ota.total) * 100) : 0;
  const detail = checking
    ? t("updates.checking")
    : s.ota.phase === "downloading"
      ? t("updates.downloadingShort", { progress: pct })
      : s.ota.phase === "ready"
        ? t("updates.readyShort")
        : s.store.decision.kind !== "none"
          ? t("updates.storeFound")
          : s.ota.phase === "error"
            ? t("updates.failed")
            : reason === "dev"
              ? t("updates.devBuild")
              : reason
                ? t("updates.unavailable")
                : s.ota.checkedAt
                  ? t("updates.upToDateAt", { time: new Date(s.ota.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
                  : undefined;

  const check = async () => {
    if (checking) return;
    setBusy(true);
    try {
      const r = await checkNow();
      if (r === "up-to-date" || (r === "unavailable" && s.store.decision.kind === "none")) toast(t("updates.upToDate"), "ok");
      else if (r === "error") toast(t("updates.failed"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const build = [Application.nativeApplicationVersion, Application.nativeBuildVersion ? `(${Application.nativeBuildVersion})` : ""].filter(Boolean).join(" ");
  const channel = deployment ? `${deployment} · ${s.ota.running ?? t("updates.builtIn")}` : t("updates.off");

  return (
    <Row>
      <AppText variant="micro">{t("updates.section")}</AppText>
      <View>
        {s.ota.phase === "ready" ? (
          <SettingsItem Icon={Download} tone="accent" label={t("updates.restart")} detail={s.ota.label} onPress={() => void restartToUpdate()} />
        ) : null}
        <SettingsItem Icon={RefreshCw} label={t("updates.check")} detail={detail} onPress={() => void check()} trailing={checking ? <Spinner /> : undefined} />
        {build ? <SettingsItem Icon={Layers} label={t("updates.build")} detail={build} mono /> : null}
        <SettingsItem last Icon={GitBranch} label={t("updates.channel")} detail={channel} mono />
      </View>
    </Row>
  );
}
