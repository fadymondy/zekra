import { router, usePathname, useRootNavigationState, type Href } from "expo-router";
import { useEffect, useState } from "react";

import { watchPush } from "@/features/push/push";
import { peekPendingRoute, subscribePendingRoute, takePendingRoute } from "@/features/push/route-queue";

/**
 * Push for the signed-in session (MH-373). Mount once in the root layout's
 * Shell with the session token (`useAuth().token`):
 *
 *   - while signed in, keeps this device registered (watchPush): on launch, on
 *     FCM token rotation; foreground messages become the in-app banner;
 *   - opens the route of a tapped notification (background tap, cold start,
 *     banner tap) once the app has landed on a real screen — not while the
 *     session is being restored or the index screen is still redirecting.
 *
 * Asks for nothing: permission is only requested from the settings row.
 */
export function usePushNotifications(session: string | null | undefined): void {
  useEffect(() => (session ? watchPush(session) : undefined), [session]);

  const pathname = usePathname();
  const nav = useRootNavigationState();
  const [pending, setPending] = useState<string | null>(peekPendingRoute());
  useEffect(() => subscribePendingRoute(() => setPending(peekPendingRoute())), []);

  useEffect(() => {
    if (!pending || !session || !nav?.key) return;
    if (pathname === "/" || pathname === "/sign-in") return; // still landing
    const route = takePendingRoute();
    setPending(null);
    if (route) router.push(route as Href);
  }, [pending, session, nav?.key, pathname]);
}
