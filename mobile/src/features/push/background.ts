import { rnfbApp, rnfbMessaging } from "@/lib/firebase";

// FCM background handler (MH-373). Loaded by index.js BEFORE expo-router's
// entry: on Android a data message can start the JS runtime headless, with no
// component tree at all, and the handler has to be registered by then.
//
// Notification messages are drawn by the OS itself. What the handler does is
// keep the home-screen widgets current while the app is closed: every push
// means something changed, so it refreshes their snapshot (MH-415). The
// widgets module is required lazily, so a headless start stays light.
//
// Kept dependency-light on purpose (no app modules): it runs headless. Guarded,
// because a build without the Firebase config files has no native default app
// and getMessaging() would throw at startup.
try {
  const app = rnfbApp();
  const messaging = rnfbMessaging();
  if (app && messaging && app.getApps().length > 0) {
    messaging.setBackgroundMessageHandler(messaging.getMessaging(), async () => {
      await require("@/features/widgets/sync").refreshWidgetsInBackground();
    });
  }
} catch {
  // No Firebase in this build: push is off, the app is not.
}

export {};
