import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

import type { DeepLinkEvent, NotificationClickEvent, OpenFileEvent } from "../../shared/ipc";
import { bridge } from "../lib/bridge";
import { HandlerStack, type StackHandler } from "./handler-stack";

/*
Things the OS hands the app — the renderer half of deep-links.ts /
ipc-handlers.ts:

  "deep-link"           zekra://… (social sign-in returns zekra://auth/github?code=…)
  "open-file"           a .md/.markdown/.mdx from Finder, the Dock, File ▸ Open
                        Markdown…, or argv — already read by main
  "notification-click"  a native notification raised with window.zekra.notify

Same stack semantics as commands (latest handler wins, `false` passes down).
An event nobody handles is PARKED for 10 minutes and delivered to the first
handler that registers — e.g. a file double-clicked while signed out reaches
the import handler once the user has signed in and the brain screen mounts.

Main buffers these until `rendererReady()`, which this provider calls after
subscribing, so nothing that arrives during launch is lost.

    useOsEvent("open-file", (f) => importMarkdown(f));
    useOsEvent("deep-link", (l) => l.host === "auth" ? finishSignIn(l) : false);
*/

type OsEvents = {
  "deep-link": DeepLinkEvent;
  "open-file": OpenFileEvent;
  "notification-click": NotificationClickEvent;
};
type OsEventName = keyof OsEvents;

const PARK_MS = 10 * 60 * 1000;

type OsEventsValue = {
  register: <K extends OsEventName>(name: K, fn: StackHandler<OsEvents[K]>) => () => void;
};

const OsEventsContext = createContext<OsEventsValue | null>(null);

export function OsEventsProvider({ children }: { children: ReactNode }) {
  const stack = useRef(new HandlerStack<OsEventName, OsEvents[OsEventName]>()).current;

  useEffect(() => {
    const deliver = <K extends OsEventName>(name: K) => (e: OsEvents[K]) => {
      if (!stack.dispatch(name, e)) stack.defer(name, e, PARK_MS);
    };
    const offs = [
      bridge().onDeepLink(deliver("deep-link")),
      bridge().onOpenFile(deliver("open-file")),
      bridge().onNotificationClick(deliver("notification-click")),
    ];
    // Subscribed — let main flush anything it buffered during launch.
    void bridge().rendererReady();
    return () => offs.forEach((off) => off());
  }, [stack]);

  const value = useMemo<OsEventsValue>(
    () => ({ register: (name, fn) => stack.register(name, fn as StackHandler<OsEvents[OsEventName]>) }),
    [stack],
  );
  return <OsEventsContext.Provider value={value}>{children}</OsEventsContext.Provider>;
}

/** Handle an OS event while mounted. The latest `fn` is always called. */
export function useOsEvent<K extends OsEventName>(name: K, fn: StackHandler<OsEvents[K]>, enabled = true): void {
  const ctx = useContext(OsEventsContext);
  if (!ctx) throw new Error("useOsEvent outside <OsEventsProvider>");
  const latest = useRef(fn);
  latest.current = fn;
  const { register } = ctx;
  useEffect(() => {
    if (!enabled) return;
    return register(name, (e) => latest.current(e));
  }, [name, register, enabled]);
}
