import { useSyncExternalStore } from "react";

import { LOCK_AFTER, type LockAfter } from "@mobile/features/security/lock-core";

import type { LockSettings } from "../../../shared/ipc";

/*
The app lock's in-memory state (MH-450): whether the window is locked right
now, and whether one of the app's own Touch ID / confirm prompts is up. The
settings themselves live in AppSettings.lock (main-process store) and are
read through the session.

`prompting` exists because a system prompt can make the app resign active:
that must not count as "went to the background" (lock) or "left the window"
(the vault hides revealed values), or the prompt would defeat itself.
*/

type State = { locked: boolean; prompting: boolean };

let state: State = { locked: false, prompting: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  const next = { ...state, ...patch };
  if (next.locked === state.locked && next.prompting === state.prompting) return;
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const lockState = {
  get: (): State => state,
  setLocked: (locked: boolean) => set({ locked }),
  setPrompting: (prompting: boolean) => set({ prompting }),
  subscribe,
};

export function useLockState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** Minutes offered for "Require after" (lock-core's seconds / 60). */
export const LOCK_MINUTES: number[] = LOCK_AFTER.map((s) => s / 60);

/** The stored minutes as lock-core's LockAfter (seconds), clamped to an offered value. */
export function afterSeconds(settings: Pick<LockSettings, "timeoutMinutes">): LockAfter {
  const s = Math.round((settings.timeoutMinutes ?? 0) * 60);
  return (LOCK_AFTER as readonly number[]).includes(s) ? (s as LockAfter) : 300;
}
