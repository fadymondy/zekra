import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/*
Shell slots — how feature code puts UI into the app chrome without editing
the shell.

  useSlot("statusbar.end", <WordCount count={n} />, { order: 10 });

Mounting a component that calls useSlot places its node in the slot; unmounting
removes it. So a status item that only makes sense while a note is open lives
inside the note screen and disappears with it.

Slot kinds:
  SINGLE (last registration wins, replaces the shell default):
    "titlebar.bell"     notification bell (default: a bell that opens the
                        Notifications route)
    "titlebar.account"  account menu (default: shell/account-menu.tsx)
  LIST (every registration renders, sorted by `order`, then mount order):
    "titlebar.start"    after the traffic-light inset (e.g. back/forward)
    "titlebar.end"      before the bell (e.g. sync indicator)
    "statusbar.start"   after connection + brain
    "statusbar.end"     word count, cursor position, language…
*/

export type SingleSlot = "titlebar.bell" | "titlebar.account";
/** "sidebar.status" — the sidebar footer's status line (sync / offline cache
 *  state from the desktop services; the shell shows "Offline" by itself). */
export type ListSlot = "titlebar.start" | "titlebar.end" | "statusbar.start" | "statusbar.end" | "sidebar.status";
export type SlotName = SingleSlot | ListSlot;

type Entry = { id: number; node: ReactNode; order: number };
type SlotState = Record<SlotName, Entry[]>;

const EMPTY: SlotState = {
  "titlebar.bell": [],
  "titlebar.account": [],
  "titlebar.start": [],
  "titlebar.end": [],
  "statusbar.start": [],
  "statusbar.end": [],
  "sidebar.status": [],
};

type SlotsApi = {
  set: (slot: SlotName, id: number, node: ReactNode, order: number) => void;
  remove: (slot: SlotName, id: number) => void;
};

// Two contexts on purpose: components that PUBLISH into a slot only read the
// stable api, so a slot update never re-renders them (which would re-publish a
// fresh node and loop). Only <Slot> reads the state.
const SlotsApiContext = createContext<SlotsApi | null>(null);
const SlotsStateContext = createContext<SlotState>(EMPTY);

export function SlotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SlotState>(EMPTY);
  const api = useMemo<SlotsApi>(
    () => ({
      set(slot, id, node, order) {
        setState((s) => {
          const list = s[slot].filter((e) => e.id !== id);
          list.push({ id, node, order });
          return { ...s, [slot]: list };
        });
      },
      remove(slot, id) {
        setState((s) => ({ ...s, [slot]: s[slot].filter((e) => e.id !== id) }));
      },
    }),
    [],
  );
  return (
    <SlotsApiContext.Provider value={api}>
      <SlotsStateContext.Provider value={state}>{children}</SlotsStateContext.Provider>
    </SlotsApiContext.Provider>
  );
}

let nextSlotId = 1;

/** Put `node` into `slot` while the calling component is mounted. */
export function useSlot(slot: SlotName, node: ReactNode, opts: { order?: number } = {}): void {
  const api = useContext(SlotsApiContext);
  if (!api) throw new Error("useSlot outside <SlotProvider>");
  const id = useRef(0);
  if (!id.current) id.current = nextSlotId++;
  const order = opts.order ?? 0;
  // Re-publish whenever the caller renders a new node; remove on unmount.
  useEffect(() => {
    api.set(slot, id.current, node, order);
  }, [api, slot, node, order]);
  useEffect(() => {
    const mine = id.current;
    return () => api.remove(slot, mine);
  }, [api, slot]);
}

/** Render a slot. For single slots, `fallback` shows when nothing is registered. */
export function Slot({ name, fallback = null }: { name: SlotName; fallback?: ReactNode }) {
  const entries = useContext(SlotsStateContext)[name];
  if (name === "titlebar.bell" || name === "titlebar.account") {
    // Most recently MOUNTED publisher wins (ids grow with mount order).
    const last = entries.reduce<Entry | null>((a, b) => (!a || b.id > a.id ? b : a), null);
    return <>{last ? last.node : fallback}</>;
  }
  if (!entries.length) return <>{fallback}</>;
  const sorted = [...entries].sort((a, b) => a.order - b.order || a.id - b.id);
  return (
    <>
      {sorted.map((e) => (
        <span key={e.id} className="contents">
          {e.node}
        </span>
      ))}
    </>
  );
}

/** Whether any of `names` currently has content (e.g. to hide an empty bar). */
export function useSlotFilled(...names: SlotName[]): boolean {
  const state = useContext(SlotsStateContext);
  return names.some((n) => state[n].some((e) => e.node !== null && e.node !== undefined && e.node !== false));
}
