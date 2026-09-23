import { useSyncExternalStore } from "react";

/*
Shared notification state between the always-mounted agent (polling, badge,
OS banners — agent.tsx), the title-bar bell and the center route.

  unread     the badge count; null until the first answer
  available  false once the server answered 404 (no notification center yet)
  version    bumped whenever the inbox changed (new items arrived, marked read
             elsewhere) so the open center refetches
*/
type State = { unread: number | null; available: boolean | null; version: number };

let state: State = { unread: null, available: null, version: 0 };
const listeners = new Set<() => void>();
let refresher: (() => void) | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const notifyStore = {
  get: () => state,
  setUnread(unread: number) {
    if (state.unread !== unread || state.available !== true) set({ unread, available: true });
  },
  setUnavailable() {
    if (state.available !== false) set({ available: false, unread: 0 });
  },
  /** The inbox changed; an open center reloads. */
  bump() {
    set({ version: state.version + 1 });
  },
  reset() {
    set({ unread: null, available: null });
  },
  /** The agent registers how to re-poll; the center calls refresh() after changes. */
  setRefresher(fn: (() => void) | null) {
    refresher = fn;
  },
  refresh() {
    refresher?.();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useNotifyState(): State {
  return useSyncExternalStore(notifyStore.subscribe, notifyStore.get, notifyStore.get);
}
