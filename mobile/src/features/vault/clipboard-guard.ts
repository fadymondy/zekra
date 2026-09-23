import * as Clipboard from "expo-clipboard";
import { AppState, Platform, type NativeEventSubscription } from "react-native";

import { CLIPBOARD_TTL_MS, shouldClearClipboard } from "./vault-core";

// Copy a secret, then wipe it from the clipboard after CLIPBOARD_TTL_MS if it
// is (as far as we can tell) still there. Module-level on purpose: the wipe
// must still happen after the vault tab unmounts. Only one secret is guarded
// at a time — a new copy replaces the old one on the clipboard anyway.
//
// The platform split lives in shouldClearClipboard (vault-core.ts): Android
// compares the clipboard to the secret (a foreground read is silent); iOS never
// reads it (that raises the paste prompt) and clears only if nothing else can
// have been copied in the meantime.

type Guard = {
  secret: string;
  leftApp: boolean;
  changedInApp: boolean;
  /** Clipboard events before this are our own write echoing back. */
  armedAt: number;
  due: boolean;
  timer: ReturnType<typeof setTimeout>;
  subs: { remove: () => void }[];
};

let guard: Guard | null = null;

function release() {
  if (!guard) return;
  clearTimeout(guard.timer);
  guard.subs.forEach((s) => s.remove());
  guard = null;
}

async function settle(g: Guard) {
  if (guard !== g) return;
  let current: string | undefined;
  if (Platform.OS === "android") current = await Clipboard.getStringAsync().catch(() => undefined);
  const clear = shouldClearClipboard({ platform: Platform.OS, leftApp: g.leftApp, changedInApp: g.changedInApp, current, secret: g.secret });
  if (guard !== g) return; // a newer copy took over while we read
  release();
  if (clear) await Clipboard.setStringAsync("").catch(() => undefined);
}

export async function copySecret(value: string): Promise<void> {
  release();
  await Clipboard.setStringAsync(value);
  release(); // a copy that raced this one has been overwritten on the clipboard
  const g: Guard = {
    secret: value,
    leftApp: false,
    changedInApp: false,
    armedAt: Date.now() + 750,
    due: false,
    timer: setTimeout(() => {
      g.due = true;
      // Reading (Android) or writing the clipboard from the background is
      // unreliable; finish when the app is next in front.
      if (AppState.currentState === "active") void settle(g);
      else if (Platform.OS !== "android") release(); // iOS: we left, so never clear
    }, CLIPBOARD_TTL_MS),
    subs: [],
  };
  const appSub: NativeEventSubscription = AppState.addEventListener("change", (next) => {
    if (next === "background") g.leftApp = true;
    if (next === "active" && g.due) void settle(g);
  });
  const clipSub = Clipboard.addClipboardListener(() => {
    if (Date.now() >= g.armedAt) g.changedInApp = true;
  });
  g.subs.push(appSub, clipSub);
  guard = g;
}
