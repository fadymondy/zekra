import { Eye, FingerprintPattern, ScanFace, ShieldCheck, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, BackHandler, Pressable, StyleSheet, View, type AppStateStatus } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheet, toast } from "@/components/kit";
import { AppText, PrimaryButton, SecondaryButton } from "@/components/ui";
import { authPromptShowing } from "@/features/vault/device-auth";
import { GOLD, GROUND } from "@/features/splash/splash-core";
import { ZekraMark } from "@/features/splash/zekra-mark";
import { useI18n, type TKey } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

import { biometricInfo, confirmOwner, type BiometricInfo } from "./biometrics";
import { lockOnLaunch, shouldLockOnReturn, shouldOffer, type BiometricKind } from "./lock-core";
import { getLockState, loadLockSettings, saveLockSettings, setLocked, useAppLock } from "./lock-store";

/*
The biometric app lock (MH-360). Mounted once in app/_layout.tsx, over the
Stack and its hosts, under the animated splash.

  - Cold start: once the session is restored, a signed-in user with the lock on
    gets the lock screen (lock-core lockOnLaunch).
  - Background: leaving records the time; coming back past "Require after"
    locks again (shouldLockOnReturn). A Face ID prompt only makes the app
    "inactive", so it never counts as leaving.
  - App switcher: while the app is inactive / in the background, a plain cover
    hides the content from the snapshot.
  - Right after a sign-in on a device with biometrics set up, a one-time sheet
    offers to turn the lock on (the answer is remembered).

The lock is an opaque overlay: the app stays mounted underneath (navigation
state survives) but is neither visible nor reachable — accessibilityViewIsModal
keeps VoiceOver inside the lock. It is a local guard for a phone left unlocked;
the server session is the access control.
*/

// The lock is always on Zekra's navy ground, like the splash, whatever the
// theme; these are the dark palette's ink / muted / line (src/theme.ts).
const INK = "#f0ebe1";
const MUTED = "#8a97b8";
const LINE = "#25355c";

export const KIND_KEY: Record<BiometricKind, TKey> = {
  faceId: "security.kind.faceId",
  touchId: "security.kind.touchId",
  face: "security.kind.face",
  fingerprint: "security.kind.fingerprint",
  iris: "security.kind.iris",
  biometrics: "security.kind.biometrics",
};

export function kindIcon(kind: BiometricKind): LucideIcon {
  switch (kind) {
    case "faceId":
    case "face":
      return ScanFace;
    case "touchId":
    case "fingerprint":
      return FingerprintPattern;
    case "iris":
      return Eye;
    default:
      return ShieldCheck;
  }
}

/** The navy ground with the cube mark: the app-switcher cover, and the lock's backdrop. */
function Cover({ children }: { children?: ReactNode }) {
  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: GROUND.dark }]}
    >
      {children ?? (
        <View style={styles.center}>
          <ZekraMark size={72} />
        </View>
      )}
    </View>
  );
}

function LockScreen({ kind }: { kind: BiometricKind }) {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const prompting = useRef(false);
  const label = t(KIND_KEY[kind]);
  const Icon = kindIcon(kind);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setBusy(true);
    setError("");
    try {
      // The system prompt falls back to the device passcode (disableDeviceFallback: false);
      // on iOS its button reads "Use passcode" after a failed match.
      const decision = await confirmOwner(t("lock.prompt"), t("common.cancel"), t("lock.usePasscode"));
      if (decision === "proceed") setLocked(false);
      else if (decision === "failed") setError(t("lock.failed"));
    } finally {
      prompting.current = false;
      setBusy(false);
    }
  }, [t]);

  // Prompt at once when the lock appears, and again each time the app comes
  // back from the background — but not after the prompt's own inactive→active
  // bounce, or a cancel would loop straight back into the prompt.
  useEffect(() => {
    let away = false;
    if (AppState.currentState === "active") void unlock();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") away = true;
      if (next === "active" && away) {
        away = false;
        void unlock();
      }
    });
    return () => sub.remove();
  }, [unlock]);

  // Android's back button would otherwise navigate the app behind the lock.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  return (
    <Cover>
      <View style={[styles.lock, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.center}>
          <ZekraMark size={72} />
          <View style={{ gap: 8, alignItems: "center", paddingHorizontal: metrics.padX }}>
            <AppText accessibilityRole="header" style={{ fontFamily: fonts.semibold, fontSize: 23, lineHeight: 33, color: INK, textAlign: "center" }}>
              {t("lock.title")}
            </AppText>
            <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: 24, color: MUTED, textAlign: "center" }}>
              {t("lock.body", { kind: label })}
            </AppText>
            {user?.email ? (
              <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, color: MUTED, writingDirection: "ltr" }}>
                {user.email}
              </AppText>
            ) : null}
          </View>
        </View>

        <View style={{ alignItems: "center", gap: 14 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("lock.unlock", { kind: label })}
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={() => void unlock()}
            hitSlop={8}
            style={({ pressed }) => [styles.unlockButton, { borderColor: pressed ? GOLD : LINE, backgroundColor: pressed ? `${GOLD}1A` : "transparent" }]}
          >
            <Icon size={34} color={GOLD} strokeWidth={1.5} />
          </Pressable>
          <AppText style={{ fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: INK }}>{t("lock.unlock", { kind: label })}</AppText>
          {error ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: metrics.padX }}>
              <View style={{ width: 7, height: 7, backgroundColor: "#d9455f" }} />
              <AppText style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, color: "#d9455f" }}>{error}</AppText>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => void signOut().then(() => setLocked(false))} style={styles.textAction}>
            <AppText style={{ fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22, color: MUTED }}>{t("auth.signOut")}</AppText>
          </Pressable>
        </View>
      </View>
    </Cover>
  );
}

/** One-time offer after a sign-in: "Lock Zekra with Face ID?" */
function EnableOffer({ info, open, onClose }: { info: BiometricInfo | null; open: boolean; onClose: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const kind = info?.kind ?? "biometrics";
  const label = t(KIND_KEY[kind]);
  const Icon = kindIcon(kind);

  const decline = () => {
    void saveLockSettings({ offered: true });
    onClose();
  };
  const accept = async () => {
    setBusy(true);
    try {
      // Confirming first proves the sensor works for this user (and shows iOS's
      // one-time Face ID permission now, not at the first lock).
      const decision = await confirmOwner(t("security.confirmOn", { kind: label }), t("common.cancel"));
      if (decision === "cancel") return; // keep the sheet: they may try again or say not now
      if (decision === "proceed") {
        await saveLockSettings({ enabled: true, offered: true });
        toast(t("security.enabledToast", { kind: label }), "ok");
      } else {
        await saveLockSettings({ offered: true });
        toast(t("security.failed"), "danger");
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={decline} title={t("lock.offerTitle", { kind: label })}>
      <View style={{ paddingHorizontal: metrics.padX, paddingTop: 6, paddingBottom: 8, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon size={28} color={p.action} strokeWidth={1.5} />
          <AppText style={{ flex: 1, fontFamily: fonts.light, fontSize: 15, lineHeight: 24, color: p.body }}>{t("lock.offerBody", { kind: label })}</AppText>
        </View>
        <PrimaryButton label={t("lock.offerYes", { kind: label })} loading={busy} onPress={() => void accept()} />
        <SecondaryButton label={t("lock.offerNo")} disabled={busy} onPress={decline} />
      </View>
    </BottomSheet>
  );
}

/** The app lock. Mount once, inside the providers, after the Stack and its hosts. */
export function AppLockGate() {
  const { ready, token } = useAuth();
  const lock = useAppLock();
  const [cover, setCover] = useState(false);
  const [info, setInfo] = useState<BiometricInfo | null>(null);
  const [offer, setOffer] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const backgroundedAt = useRef<number | null>(null);
  const launchDecided = useRef(false);
  const prev = useRef<{ ready: boolean; token: string | null }>({ ready: false, token: null });
  const signedIn = !!token;

  useEffect(() => {
    void loadLockSettings();
  }, []);

  // The sensor's name for the lock screen; enrolment can change between uses.
  useEffect(() => {
    if (signedIn && lock.settings.enabled) void biometricInfo().then(setInfo);
  }, [signedIn, lock.settings.enabled, lock.locked]);

  // Cold start: decide once, when both the session and the settings are in.
  useEffect(() => {
    if (launchDecided.current || !ready || !lock.loaded) return;
    launchDecided.current = true;
    if (lockOnLaunch(getLockState().settings, !!tokenRef.current)) setLocked(true);
  }, [ready, lock.loaded]);

  // Signed out (here, elsewhere, or by a revoked session): nothing to guard.
  useEffect(() => {
    if (!signedIn) setLocked(false);
  }, [signedIn]);

  // A sign-in in this run (not a restored session): maybe offer the lock.
  useEffect(() => {
    const fresh = prev.current.ready && !prev.current.token && !!token;
    prev.current = { ready, token };
    if (!fresh) return;
    let alive = true;
    void (async () => {
      await loadLockSettings();
      const found = await biometricInfo();
      if (!alive || !shouldOffer(getLockState().settings, true, found.availability)) return;
      setInfo(found);
      // Let the hand-off to Brains finish first.
      setTimeout(() => alive && setOffer(true), 700);
    })();
    return () => {
      alive = false;
    };
  }, [ready, token]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const { settings } = getLockState();
      const guarded = settings.enabled && !!tokenRef.current;
      if (next === "background") {
        if (guarded) backgroundedAt.current = Date.now();
        setCover(guarded);
      } else if (next === "inactive") {
        // Not for the app's own Face ID prompt (vault reveal, the lock itself).
        setCover(guarded && !authPromptShowing());
      } else if (next === "active") {
        if (shouldLockOnReturn(settings, !!tokenRef.current, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
        setCover(false);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  const guarded = signedIn && lock.settings.enabled;
  let overlay: ReactNode = null;
  if (signedIn && !lock.loaded) overlay = <Cover />; // settings not read yet: never flash content
  else if (guarded && lock.locked) overlay = <LockScreen kind={info?.kind ?? "biometrics"} />;
  else if (guarded && cover) overlay = <Cover />;

  return (
    <>
      {overlay}
      <EnableOffer info={info} open={offer && signedIn && !lock.locked} onClose={() => setOffer(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22 },
  lock: { flex: 1, justifyContent: "space-between" },
  unlockButton: { width: 76, height: 76, borderRadius: 38, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  textAction: { minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
});
