import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { REVEAL_TTL_MS } from "./vault-core";

export type Revealed = { value: string; until: number };

/**
 * Revealed secret values, held in component state only — never in the
 * react-query cache, never logged. Each value hides itself after REVEAL_TTL_MS,
 * and all of them hide when the app leaves the foreground (so the value is not
 * in the app-switcher snapshot either).
 *
 * `epoch` guards in-flight reveals: anything that hides everything bumps it,
 * and a reveal that started under an older epoch is discarded when it lands.
 */
export function useRevealed() {
  const [values, setValues] = useState<Record<string, Revealed>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const epoch = useRef(0);
  // iOS reports "inactive" while the Face ID / passcode sheet is up; that must
  // not count as leaving the app.
  const prompting = useRef(false);

  const hide = useCallback((name: string) => {
    const timer = timers.current.get(name);
    if (timer) clearTimeout(timer);
    timers.current.delete(name);
    setValues((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const hideAll = useCallback(() => {
    epoch.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setValues({});
  }, []);

  /** Show a value; false if the reveal was overtaken (app left, tab closed). */
  const show = useCallback((name: string, value: string, startedAt: number) => {
    if (startedAt !== epoch.current || AppState.currentState === "background") return false;
    const old = timers.current.get(name);
    if (old) clearTimeout(old);
    timers.current.set(name, setTimeout(() => hide(name), REVEAL_TTL_MS));
    setValues((prev) => ({ ...prev, [name]: { value, until: Date.now() + REVEAL_TTL_MS } }));
    return true;
  }, [hide]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || (next === "inactive" && !prompting.current)) hideAll();
    });
    const pending = timers.current;
    return () => {
      sub.remove();
      epoch.current += 1;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [hideAll]);

  return {
    values,
    show,
    hide,
    hideAll,
    /** The epoch a reveal starts under; pass it back to show(). */
    begin: () => epoch.current,
    /** Mark the system auth prompt as up/down. */
    setPrompting: (on: boolean) => {
      prompting.current = on;
    },
  };
}
