import { Platform } from "react-native";
import { registerWidgetTaskHandler, type WidgetTaskHandler } from "react-native-android-widget";

import { renderAndroidWidget } from "./android-widgets";
import { helpers, widgetLabels } from "./labels";
import { readSnapshot, writeSnapshot } from "./store";
import { fetchSnapshot, pushSnapshot } from "./sync";
import { buildWidgetProps, type WidgetSnapshot } from "./widgets-core";

// Android widget task (MH-360). The launcher asks for a render when a widget
// is added or resized and on each provider's update period (30 min, the
// platform minimum — app.json). That runs headless, so this is registered at
// the entry (index.js) through registerWidgets(), before the app mounts.
//
// Kept dependency-light like push/background.ts: no router, no React Query.

/** Refetch on a scheduled update when the snapshot is older than this. */
const STALE_MS = 15 * 60_000;

export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetAction === "WIDGET_DELETED" || widgetAction === "WIDGET_CLICK") return;
  let snapshot: WidgetSnapshot | null = readSnapshot();
  const stale = !snapshot || Date.now() - snapshot.updatedAt > STALE_MS;
  if (stale && (widgetAction === "WIDGET_UPDATE" || widgetAction === "WIDGET_ADDED")) {
    const fresh = await fetchSnapshot(10_000);
    if (fresh) {
      snapshot = fresh;
      writeSnapshot(fresh);
      // The other widget sizes on the home screen get the new data too.
      void pushSnapshot(fresh).catch(() => undefined);
    }
  }
  const props = snapshot ? buildWidgetProps(snapshot, widgetLabels(snapshot.locale), helpers) : null;
  renderWidget(renderAndroidWidget(widgetInfo.widgetName, props, widgetInfo));
};

let registered = false;

/** Register the Android widget task. Call once from index.js, before expo-router's entry. No-op elsewhere. */
export function registerWidgets(): void {
  if (registered || Platform.OS !== "android") return;
  registered = true;
  registerWidgetTaskHandler(widgetTaskHandler);
}
