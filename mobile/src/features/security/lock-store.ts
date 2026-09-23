import { useSyncExternalStore } from "react";

import { getStored, setStored } from "@/lib/storage";

import { DEFAULT_LOCK, parseLockSettings, serializeLockSettings, type LockSettings } from "./lock-core";

// The app lock's state, shared by the gate (app-lock-gate.tsx) and the
// Security settings page. Settings live in SecureStore (Keychain / Keystore)
// next to the session, not in plain app storage.

const STORE_KEY = "zekra.lock.v1";

export type LockState = {
  /** Settings have been read from storage. Until then the gate covers a signed-in app. */
  loaded: boolean;
  settings: LockSettings;
  /** The lock screen is up. */
  locked: boolean;
};

let state: LockState = { loaded: false, settings: { ...DEFAULT_LOCK }, locked: false };
const listeners = new Set<() => void>();

function set(patch: Partial<LockState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLockState(): LockState {
  return state;
}

let loading: Promise<void> | null = null;

export function loadLockSettings(): Promise<void> {
  if (!loading) {
    loading = getStored(STORE_KEY)
      .then((raw) => set({ loaded: true, settings: parseLockSettings(raw) }))
      .catch(() => set({ loaded: true }));
  }
  return loading;
}

export async function saveLockSettings(patch: Partial<LockSettings>): Promise<void> {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  await setStored(STORE_KEY, serializeLockSettings(settings));
}

export function setLocked(locked: boolean) {
  if (state.locked !== locked) set({ locked });
}

/** The lock's settings and whether it is up; re-renders on every change. */
export function useAppLock() {
  const s = useSyncExternalStore(subscribe, getLockState, getLockState);
  return {
    ...s,
    setEnabled: (enabled: boolean) => saveLockSettings({ enabled, offered: true }),
    setAfter: (after: LockSettings["after"]) => saveLockSettings({ after }),
    lock: () => setLocked(true),
    unlock: () => setLocked(false),
  };
}
