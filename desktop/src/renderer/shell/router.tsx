import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/*
The desktop's router: a typed union held in React state, with a small back
stack. No URLs — the renderer is a single file:// page and deep links arrive
as typed events, so a string router would only add parsing.

Adding a screen (feature teams):
  1. add a variant to `Route` below,
  2. render it in routes/index.tsx (the switch is exhaustive, so tsc points you
     at every place that needs the new case),
  3. optionally add an activity-bar entry (shell/activity-bar.tsx).
*/

export type BrainTab = "notes" | "presentations" | "vault";
export type BrainList = "all" | "pinned" | "recent" | "archived";
/** Settings is its own window (screens/settings-window.tsx), not a route:
 *  bridge().openSettingsWindow(section). */
export type { SettingsSectionId as SettingsSection } from "../../shared/ipc";

export type Route =
  | { name: "brains" }
  // `list`: which notes list the source list picked (default "all").
  | { name: "brain"; ns: string; tab: BrainTab; noteId?: string; list?: BrainList }
  | { name: "search"; query?: string; ns?: string };
// Not routes (Health Debug's window architecture): Settings is a window, the
// notification center is the title bar bell's popover.

export type RouteName = Route["name"];

type RouterValue = {
  route: Route;
  /** Push a route (Back returns here). */
  navigate: (to: Route) => void;
  /** Replace the current route without growing the back stack. */
  replace: (to: Route) => void;
  back: () => void;
  canGoBack: boolean;
};

const RouterContext = createContext<RouterValue | null>(null);

const MAX_STACK = 50;

function same(a: Route, b: Route): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const route = stack[stack.length - 1];

  const navigate = useCallback((to: Route) => {
    setStack((s) => (same(s[s.length - 1], to) ? s : [...s.slice(-MAX_STACK + 1), to]));
  }, []);
  const replace = useCallback((to: Route) => {
    setStack((s) => [...s.slice(0, -1), to]);
  }, []);
  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ route, navigate, replace, back, canGoBack: stack.length > 1 }),
    [route, navigate, replace, back, stack.length],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const v = useContext(RouterContext);
  if (!v) throw new Error("useRouter outside <RouterProvider>");
  return v;
}

/** The route, narrowed: `useRoute("brain")` is the brain route or null. */
export function useRoute<N extends RouteName>(name: N): Extract<Route, { name: N }> | null {
  const { route } = useRouter();
  return route.name === name ? (route as Extract<Route, { name: N }>) : null;
}

/**
 * Parse the compact route strings used where a Route cannot travel as an
 * object — native notification payloads, push data, zekra://open/… links:
 *
 *   "brains" | "search[:query]"
 *   "brain:<ns>[:notes|presentations|vault]"
 *   "note:<ns>:<noteId>"
 *
 * "notifications" (the bell popover) and "settings[:section]" (the Settings
 * window) are not routes: shell/base-commands.tsx opens them.
 *
 * Unknown strings return null (the caller ignores them).
 */
export function routeFromString(s: string): Route | null {
  const [head, a, b] = s.split(":");
  switch (head) {
    case "brains":
      return { name: "brains" };
    case "search":
      return { name: "search", query: a || undefined };
    case "brain": {
      if (!a) return null;
      const tabs: BrainTab[] = ["notes", "presentations", "vault"];
      return { name: "brain", ns: a, tab: tabs.includes(b as BrainTab) ? (b as BrainTab) : "notes" };
    }
    case "note":
      return a && b ? { name: "brain", ns: a, tab: "notes", noteId: b } : null;
    default:
      return null;
  }
}
