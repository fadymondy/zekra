import { routeFromData } from "@/features/push/push-core";
import { logEvent } from "@/lib/analytics";
import { breadcrumb } from "@/lib/crash";

// The route of a tapped notification, waiting for the navigator (MH-373).
// A notification can be tapped before the app has a navigation tree — a cold
// start, while the session is restored and the index screen redirects — so the
// route is queued here and usePushNotifications() pushes it once the app has
// landed on a real screen.

let pendingRoute: string | null = null;
const listeners = new Set<() => void>();

/** Queue the route a notification's data points at (ignored unless allowed). */
export function openPushRoute(data: Record<string, unknown> | undefined | null): void {
  const route = routeFromData(data);
  if (!route) return;
  const kind = route.split("/")[1];
  breadcrumb(`push: open ${kind}`);
  logEvent("push_open", { type: kind });
  pendingRoute = route;
  listeners.forEach((l) => l());
}

/** Queue an already-validated route (the foreground banner). */
export function queueRoute(route: string | null): void {
  if (!route) return;
  openPushRoute({ route });
}

export function takePendingRoute(): string | null {
  const r = pendingRoute;
  pendingRoute = null;
  return r;
}

export function peekPendingRoute(): string | null {
  return pendingRoute;
}

export function subscribePendingRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
