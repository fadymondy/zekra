import { useEffect, useState } from "react";

import type { UpdateState } from "../../../shared/ipc";
import { bridge } from "../../lib/bridge";

/*
The updater's state (src/main/updater.ts) in the renderer, plus the one
"open the Software Update sheet" signal every entry point shares (the sidebar
loader, the ready card, Settings ▸ About, Help ▸ Check for Updates… / the tray
via the "update:show" command). The sheet itself is mounted once by
UpdateHost (update-host.tsx).
*/

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void bridge()
      .getUpdateState()
      .then((s) => {
        if (live) setState(s);
      })
      .catch(() => undefined);
    const off = bridge().onUpdateState(setState);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

type SheetListener = (checkNow: boolean) => void;
const sheetListeners = new Set<SheetListener>();

/** Open the Software Update sheet; `checkNow` also runs a check when there is
 *  nothing in flight (idle, up to date, failed). */
export function openUpdateSheet(checkNow = false): void {
  for (const fn of sheetListeners) fn(checkNow);
}

export function onOpenUpdateSheet(fn: SheetListener): () => void {
  sheetListeners.add(fn);
  return () => sheetListeners.delete(fn);
}

/** A check makes sense (nothing is downloading or waiting to install). */
export function canCheck(s: UpdateState | null): boolean {
  const st = s?.status ?? "idle";
  return st === "idle" || st === "not-available" || st === "error";
}

export function installNow(): void {
  void bridge().installUpdate();
}

export function snooze(): void {
  void bridge().snoozeUpdate?.();
}
