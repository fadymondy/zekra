import { File, Paths } from "expo-file-system";

import { parseSnapshot, type WidgetSnapshot } from "./widgets-core";

// The last snapshot, kept in the app's documents so headless code (the Android
// widget task, an FCM background refresh) can re-render the widgets without
// the React tree. Not secret: brain names and counts, never the session token.

const file = () => new File(Paths.document, "zekra-widgets.v1.json");

export function readSnapshot(): WidgetSnapshot | null {
  try {
    const f = file();
    return f.exists ? parseSnapshot(f.textSync()) : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(snapshot: WidgetSnapshot): void {
  try {
    const f = file();
    if (!f.exists) f.create({ intermediates: true });
    f.write(JSON.stringify(snapshot));
  } catch {
    // Best-effort: the widgets still get this snapshot in memory.
  }
}
