import { useCallback, useEffect, useRef, useState } from "react";

import { REVEAL_TTL_MS } from "@mobile/features/vault/vault-core";

import { bridge } from "../../lib/bridge";
import { lockState } from "../security/lock-state";

export type Revealed = { value: string; until: number };

/**
 * Revealed secret values (MH-450, after mobile's use-revealed.ts), held in
 * component state only — never cached, never logged. Each value hides itself
 * after REVEAL_TTL_MS, and all of them hide when the window loses focus, the
 * app goes to the background, or the app lock engages.
 *
 * The app's own Touch ID / confirm prompt can blur the window; that must not
 * count as leaving (lockState.prompting).
 *
 * `epoch` guards in-flight reveals: anything that hides everything bumps it,
 * and a reveal that started under an older epoch is discarded when it lands.
 */
export function useRevealed() {
  const [values, setValues] = useState<Record<string, Revealed>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const epoch = useRef(0);

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
    setValues((prev) => (Object.keys(prev).length ? {} : prev));
  }, []);

  /** Show a value; false if the reveal was overtaken (window left, tab closed). */
  const show = useCallback(
    (name: string, value: string, startedAt: number) => {
      if (startedAt !== epoch.current || lockState.get().locked) return false;
      const old = timers.current.get(name);
      if (old) clearTimeout(old);
      timers.current.set(name, setTimeout(() => hide(name), REVEAL_TTL_MS));
      setValues((prev) => ({ ...prev, [name]: { value, until: Date.now() + REVEAL_TTL_MS } }));
      return true;
    },
    [hide],
  );

  useEffect(() => {
    const onBlur = () => {
      if (!lockState.get().prompting) hideAll();
    };
    window.addEventListener("blur", onBlur);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hideAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const offActivity = bridge().onAppActivity((e) => {
      if (e.state !== "active" && !lockState.get().prompting) hideAll();
    });
    const offLock = lockState.subscribe(() => {
      if (lockState.get().locked) hideAll();
    });
    const pending = timers.current;
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      offActivity();
      offLock();
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
  };
}
