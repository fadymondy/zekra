import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { getLockState } from "@/features/security/lock-store";
import { getStored, setStored } from "@/lib/storage";

import { createShakeDetector } from "./mahaam-core";

type Sensors = typeof import("expo-sensors");

// Shake to report: a deliberate shake opens "Report a problem" with a screenshot
// of the screen the user is on. Listens only while it can act — enabled in
// Settings → About (default on), signed in, the app in the foreground and the
// app lock NOT up (and its settings loaded, so a locked launch is never raced).

const STORE_KEY = "zekra.mahaam.shake.v1";
let enabled = true;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  if (loaded) return;
  loaded = true;
  void getStored(STORE_KEY).then((raw) => {
    if (raw === "0") {
      enabled = false;
      emit();
    }
  });
}

export function setShakeEnabled(on: boolean): void {
  enabled = on;
  emit();
  void setStored(STORE_KEY, on ? "1" : "0");
}

/** The "Shake to report" setting. */
export function useShakeSetting(): [boolean, (on: boolean) => void] {
  load();
  const on = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => enabled,
    () => enabled,
  );
  return [on, setShakeEnabled];
}

// Loaded on first use: expo-sensors binds its native module at import, which
// would throw at app start in a binary built before it was added.
function sensors(): Sensors | null {
  try {
    return require("expo-sensors") as Sensors;
  } catch {
    return null;
  }
}

/** Ignore shakes this soon after returning to the foreground (the lock may be about to come up). */
const RESUME_GRACE_MS = 1200;

/**
 * Calls `onShake` for each deliberate shake while listening is allowed.
 * `blocked()` lets the host veto (e.g. the report sheet is already open).
 */
export function useShakeToReport({ signedIn, onShake, blocked }: { signedIn: boolean; onShake: () => void; blocked: () => boolean }): void {
  const [on] = useShakeSetting();
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    if (!on || !signedIn || Platform.OS === "web") return;
    const mod = sensors();
    if (!mod) return;
    const { Accelerometer } = mod;
    let sub: { remove(): void } | null = null;
    let alive = true;
    let available = false;
    let activeSince = Date.now();
    const detect = createShakeDetector();

    const start = () => {
      if (sub || !alive || !available) return;
      try {
        Accelerometer.setUpdateInterval(60);
        sub = Accelerometer.addListener((a) => {
          const t = Date.now();
          if (!detect(a, t)) return;
          const lock = getLockState();
          if (!lock.loaded || lock.locked) return; // never over (or racing) the lock screen
          if (AppState.currentState !== "active" || t - activeSince < RESUME_GRACE_MS || blockedRef.current()) return;
          onShakeRef.current();
        });
      } catch {
        sub = null;
      }
    };
    const stop = () => {
      sub?.remove();
      sub = null;
    };

    void Accelerometer.isAvailableAsync()
      .then((ok) => {
        available = ok;
        if (ok && AppState.currentState === "active") start();
      })
      .catch(() => undefined);

    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        activeSince = Date.now();
        start();
      } else stop();
    });
    return () => {
      alive = false;
      appSub.remove();
      stop();
    };
  }, [on, signedIn]);
}
