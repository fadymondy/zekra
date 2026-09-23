import { useEffect, useRef } from "react";

import { useNotifyState } from "../features/notify/store";
import { bridge } from "../lib/bridge";
import { useSession } from "./session";

/*
The main window tells the menubar menu (src/main/tray.ts) what only it knows:
the unread notification count (the Notifications item's title) and the brains
(the Brains ▸ submenu). Pushed on change; signed out = nothing.
*/
export function TrayStateSync() {
  const { user, brains } = useSession();
  const { unread, available } = useNotifyState();
  const last = useRef("");

  useEffect(() => {
    const state = {
      unread: user && available !== false ? unread : null,
      brains: user ? (brains ?? []).map((b) => ({ namespace: b.namespace, name: b.displayName || b.namespace })) : [],
    };
    const key = JSON.stringify(state);
    if (key === last.current) return;
    last.current = key;
    void bridge().setTrayState?.(state);
  }, [user, brains, unread, available]);

  return null;
}
