import { usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, BackHandler, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheet } from "@/components/kit";
import { AppText, PrimaryButton, SecondaryButton } from "@/components/ui";
import { ZekraMark } from "@/features/splash/zekra-mark";
import { useI18n } from "@/lib/i18n";
import { metrics, usePalette } from "@/theme";

import {
  dismissOtaSheet,
  dismissStorePrompt,
  getSnapshot,
  onBackground,
  onForeground,
  openStore,
  restartToUpdate,
  setEditing,
  startUpdates,
  subscribe,
  type UpdatesState,
} from "./controller";
import { formatBytes, isEditorRoute, progressFraction } from "./update-core";
import { setCurrentPath } from "./unsaved-work";

export function useUpdates(): UpdatesState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/*
Mounted once at the root (app/_layout.tsx). Drives the updater (controller.ts)
from the app's lifecycle and shows its four faces:

  update sheet    OTA, optional: "Update available — downloading…" with a
                  progress bar, then Restart to update / Later.
  update loader   OTA, mandatory: full screen, the cube mark + progress, then
                  the app restarts by itself.
  store sheet     a newer native version in the App Store / Play: Open Store /
                  Not now (once per version).
  update gate     below the minimum supported version: full screen, Open Store
                  only.
*/
export function UpdateHost() {
  const s = useUpdates();
  const pathname = usePathname();

  useEffect(() => {
    void startUpdates();
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && last !== "active") onForeground();
      if (next === "background") onBackground();
      last = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setCurrentPath(pathname);
    setEditing(isEditorRoute(pathname));
  }, [pathname]);

  return (
    <>
      <OtaSheet s={s} />
      <StoreSheet s={s} />
      {s.ota.ui === "blocking" ? <UpdateLoader s={s} /> : s.store.ui === "force" ? <UpdateGate s={s} /> : null}
    </>
  );
}

function ProgressBar({ value }: { value: number | null }) {
  const p = usePalette();
  return (
    <View style={[styles.track, { backgroundColor: p.soft }]} accessibilityRole="progressbar" accessibilityValue={value === null ? undefined : { min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={[styles.fill, { backgroundColor: p.action, width: `${Math.round((value ?? 0.15) * 100)}%` }]} />
    </View>
  );
}

function downloadLine(t: ReturnType<typeof useI18n>["t"], s: UpdatesState): string {
  const done = formatBytes(s.ota.received);
  const total = formatBytes(s.ota.total);
  return done && total ? t("updates.downloadingBytes", { done, total }) : t("updates.downloading");
}

function OtaSheet({ s }: { s: UpdatesState }) {
  const { t } = useI18n();
  const p = usePalette();
  const ready = s.ota.phase === "ready";
  const open = s.ota.ui === "sheet" && (s.ota.phase === "downloading" || ready);
  return (
    <BottomSheet open={open} onClose={dismissOtaSheet} title={ready ? t("updates.readyTitle") : t("updates.available")} subtitle={s.ota.label ? `Zekra · ${s.ota.label}` : undefined}>
      <View style={{ paddingHorizontal: metrics.padX, paddingTop: 4, gap: 14 }}>
        {ready ? (
          <AppText variant="meta">{t("updates.readyBody")}</AppText>
        ) : (
          <View style={{ gap: 8 }}>
            <ProgressBar value={progressFraction(s.ota.received ?? 0, s.ota.total ?? 0)} />
            <AppText variant="meta">{downloadLine(t, s)}</AppText>
          </View>
        )}
        {s.ota.releaseNotes ? (
          <View style={{ gap: 6 }}>
            <AppText variant="micro">{t("updates.whatsNew")}</AppText>
            <ScrollView style={{ maxHeight: 180 }}>
              <AppText variant="body" style={{ color: p.body }}>{s.ota.releaseNotes}</AppText>
            </ScrollView>
          </View>
        ) : null}
        <View style={{ gap: 10, paddingTop: 4 }}>
          {ready ? <PrimaryButton label={t("updates.restart")} onPress={() => void restartToUpdate()} /> : null}
          <SecondaryButton label={t("updates.later")} onPress={dismissOtaSheet} />
        </View>
      </View>
    </BottomSheet>
  );
}

function storeButtonLabel(t: ReturnType<typeof useI18n>["t"]): string {
  return Platform.OS === "android" ? t("updates.openPlayStore") : t("updates.openAppStore");
}

function StoreSheet({ s }: { s: UpdatesState }) {
  const { t } = useI18n();
  const d = s.store.decision;
  const open = s.store.ui === "prompt" && d.kind === "prompt" && s.ota.ui !== "blocking";
  const version = d.kind === "prompt" ? d.version : "";
  const body = !version ? t("updates.storeBodyGeneric") : Platform.OS === "android" ? t("updates.storeBodyAndroid", { version }) : t("updates.storeBodyIos", { version });
  return (
    <BottomSheet open={open} onClose={dismissStorePrompt} title={t("updates.storeTitle")}>
      <View style={{ paddingHorizontal: metrics.padX, paddingTop: 4, gap: 14 }}>
        <AppText variant="meta">{body}</AppText>
        <View style={{ gap: 10 }}>
          <PrimaryButton label={storeButtonLabel(t)} onPress={() => void openStore()} />
          <SecondaryButton label={t("updates.notNow")} onPress={dismissStorePrompt} />
        </View>
      </View>
    </BottomSheet>
  );
}

/** Android back must not slip past a full-screen loader / gate into the app. */
function useSwallowBack(): void {
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);
}

/** Full screen: a mandatory OTA update downloading / restarting. */
function UpdateLoader({ s }: { s: UpdatesState }) {
  useSwallowBack();
  const { t } = useI18n();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const installing = s.ota.phase === "installing" || s.ota.phase === "ready";
  return (
    <View style={[StyleSheet.absoluteFill, styles.full, { backgroundColor: p.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
      <ZekraMark size={88} />
      <View style={{ alignItems: "center", gap: 8, paddingHorizontal: metrics.padX }}>
        <AppText variant="title" style={{ textAlign: "center" }}>{t("updates.mandatoryTitle")}</AppText>
        {s.ota.mandatory ? <AppText variant="meta" style={{ textAlign: "center" }}>{t("updates.mandatoryBody")}</AppText> : null}
      </View>
      <View style={{ alignSelf: "stretch", paddingHorizontal: metrics.padX * 1.5, gap: 8 }}>
        <ProgressBar value={installing ? 1 : progressFraction(s.ota.received ?? 0, s.ota.total ?? 0)} />
        <AppText variant="meta" style={{ textAlign: "center" }}>{installing ? t("updates.restarting") : downloadLine(t, s)}</AppText>
      </View>
    </View>
  );
}

/** Full screen: this native version is below the supported minimum. */
function UpdateGate({ s }: { s: UpdatesState }) {
  useSwallowBack();
  const { t } = useI18n();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, styles.full, { backgroundColor: p.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
      <ZekraMark size={88} />
      <View style={{ alignItems: "center", gap: 8, paddingHorizontal: metrics.padX }}>
        <AppText variant="title" style={{ textAlign: "center" }}>{t("updates.requiredTitle")}</AppText>
        <AppText variant="meta" style={{ textAlign: "center" }}>{s.store.message || t("updates.requiredBody")}</AppText>
      </View>
      <View style={{ alignSelf: "stretch", paddingHorizontal: metrics.padX * 1.5 }}>
        <PrimaryButton label={storeButtonLabel(t)} onPress={() => void openStore()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { zIndex: 1000, elevation: 1000, alignItems: "center", justifyContent: "center", gap: 28 },
  track: { height: 6, borderRadius: 3, overflow: "hidden", alignSelf: "stretch" },
  fill: { height: 6, borderRadius: 3 },
});
