import { useSyncExternalStore } from "react";

/*
Device-only notification preferences (Settings ▸ Notifications). Kept in the
renderer's localStorage (Electron userData) rather than AppSettings: nothing
outside the renderer reads them.

  os     raise a macOS notification for new items while the window is in the background
  sound  play the system sound with it
  badge  unread count on the Dock icon
*/
export type NotifyPrefs = { os: boolean; sound: boolean; badge: boolean };

const KEY = "zekra.notify.prefs";
const DEFAULTS: NotifyPrefs = { os: true, sound: true, badge: true };

function read(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<NotifyPrefs>;
    return {
      os: typeof v.os === "boolean" ? v.os : DEFAULTS.os,
      sound: typeof v.sound === "boolean" ? v.sound : DEFAULTS.sound,
      badge: typeof v.badge === "boolean" ? v.badge : DEFAULTS.badge,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getNotifyPrefs(): NotifyPrefs {
  return current;
}

export function setNotifyPrefs(patch: Partial<NotifyPrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage full / disabled: the change still applies for this session
  }
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useNotifyPrefs(): NotifyPrefs {
  return useSyncExternalStore(subscribe, getNotifyPrefs, getNotifyPrefs);
}
