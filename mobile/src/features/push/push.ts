import type { RemoteMessage } from "@react-native-firebase/messaging";
import * as Application from "expo-application";
import { getLocales } from "expo-localization";
import { PermissionsAndroid, Platform } from "react-native";

import { markReadFromPush } from "@/features/notify/api";
import { emitNotify, onNotify } from "@/features/notify/bus";
import { showPushBanner } from "@/features/push/banner";
import { bannerFrom, derivePushState, pushLocale, pushUserAgent, type OsPermission, type PushState } from "@/features/push/push-core";
import { openPushRoute } from "@/features/push/route-queue";
import { logEvent } from "@/lib/analytics";
import { request } from "@/lib/api";
import { breadcrumb, firebaseReady, reportError } from "@/lib/crash";
import { rnfbMessaging } from "@/lib/firebase";
import { getStored, removeStored, setStored } from "@/lib/storage";

// Push on the phone (MH-373), through Firebase Cloud Messaging (APNs is reached
// via Firebase). Ported from fadymondy.com/mobile/src/lib/push.ts.
//
// Registration is /api/me/device_tokens, which takes the account from the
// session — there is no user id to send, so none to forge.
//
// Permission is NEVER asked at launch: iOS gives exactly one prompt, and
// spending it before the app has shown any value is how an app ends up
// permanently denied. It is asked when the user turns notifications on in
// Settings (NotificationSettingsRow → enablePush). After that, every launch and
// every token rotation re-registers silently (watchPush) — FCM rotates tokens
// without telling anyone, the usual cause of "notifications stopped working".
//
// Every entry point is a no-op in a build without the Firebase config files.

const TOKEN_KEY = "zekra.push.token"; // the token this device last registered (sign-out removes exactly that row)
const OPTOUT_KEY = "zekra.push.optout"; // "1" = the user turned notifications off in the app
const ANDROID_BLOCKED_KEY = "zekra.push.android-blocked"; // "1" = Android answered never_ask_again
const APP_LOCALE_KEY = "zekra.locale"; // the app's language (src/lib/i18n.tsx)

type MessagingModule = typeof import("@react-native-firebase/messaging");
type Messaging = ReturnType<MessagingModule["getMessaging"]>;
// Only reached once messaging() returned an instance, so the module is loaded.
const fm = () => rnfbMessaging() as MessagingModule;

function messaging(): Messaging | null {
  const mod = rnfbMessaging();
  if (!firebaseReady() || !mod) return null;
  try {
    return mod.getMessaging();
  } catch {
    return null;
  }
}

async function osPermission(m: Messaging, ask: boolean): Promise<OsPermission> {
  if (Platform.OS === "android") {
    // Android 12 and below grant notifications at install time.
    if (typeof Platform.Version === "number" && Platform.Version < 33) return "granted";
    const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(perm)) {
      await removeStored(ANDROID_BLOCKED_KEY);
      return "granted";
    }
    if (!ask) return (await getStored(ANDROID_BLOCKED_KEY)) === "1" ? "denied" : "undetermined";
    const result = await PermissionsAndroid.request(perm);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted";
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      await setStored(ANDROID_BLOCKED_KEY, "1");
      return "denied";
    }
    return "undetermined";
  }
  const status = ask ? await fm().requestPermission(m) : await fm().hasPermission(m);
  if (status === fm().AuthorizationStatus.AUTHORIZED || status === fm().AuthorizationStatus.PROVISIONAL || status === fm().AuthorizationStatus.EPHEMERAL) return "granted";
  if (status === fm().AuthorizationStatus.DENIED) return "denied";
  return "undetermined";
}

async function locale(): Promise<"en" | "ar"> {
  const app = await getStored(APP_LOCALE_KEY);
  if (app === "ar" || app === "en") return app;
  try {
    return pushLocale(getLocales()[0]?.languageTag);
  } catch {
    return "en";
  }
}

async function register(session: string, fcmToken: string): Promise<void> {
  await request("/api/me/device_tokens", {
    method: "POST",
    token: session,
    json: {
      token: fcmToken,
      platform: Platform.OS,
      user_agent: pushUserAgent(Platform.OS, Platform.Version, Application.nativeApplicationVersion ?? "", Application.nativeBuildVersion ?? ""),
      locale: await locale(),
    },
  });
  await setStored(TOKEN_KEY, fcmToken);
}

/** What the settings row shows. Never throws. */
export async function pushStatus(): Promise<PushState> {
  const m = messaging();
  if (!m) return "unavailable";
  try {
    const [permission, optout, token] = await Promise.all([osPermission(m, false), getStored(OPTOUT_KEY), getStored(TOKEN_KEY)]);
    return derivePushState({ available: true, permission, optedOut: optout === "1", registered: !!token });
  } catch (e) {
    reportError(e, "push: status");
    return "off";
  }
}

/** The user's explicit "turn notifications on": asks (once, here), then registers this device. */
export async function enablePush(session: string): Promise<PushState> {
  const m = messaging();
  if (!m) return "unavailable";
  try {
    await removeStored(OPTOUT_KEY);
    const permission = await osPermission(m, true);
    if (permission !== "granted") {
      logEvent("push_permission", { result: permission });
      return permission === "denied" ? "denied" : "off";
    }
    await register(session, await fm().getToken(m));
    breadcrumb("push: registered");
    logEvent("push_enabled", { platform: Platform.OS });
    return "on";
  } catch (e) {
    reportError(e, "push: enable");
    throw e;
  }
}

/** The user's "turn notifications off": this device stops receiving, the preference sticks. */
export async function disablePush(session: string): Promise<PushState> {
  await setStored(OPTOUT_KEY, "1");
  await unregisterPush(session);
  logEvent("push_disabled", { platform: Platform.OS });
  return "off";
}

/**
 * Sign-out: stop pushes for this account on this device. Call BEFORE the
 * session is dropped (it authenticates with it). Best effort: never throws, so
 * sign-out still works offline.
 */
export async function unregisterPush(session: string | null | undefined): Promise<void> {
  try {
    const token = await getStored(TOKEN_KEY);
    if (!token || !session) return;
    await request("/api/me/device_tokens/unregister", { method: "POST", token: session, json: { token } });
  } catch (e) {
    reportError(e, "push: unregister");
  } finally {
    await removeStored(TOKEN_KEY);
  }
}

/** Sends a test notification to every device of the signed-in account. */
export async function sendTestPush(session: string): Promise<{ sent: number; devices: number }> {
  return request<{ sent: number; devices: number }>("/api/me/device_tokens/test", { method: "POST", token: session, json: {} });
}

// ---- keeping a signed-in device registered -------------------------------------

let coldStartHandled = false;

/**
 * Keeps a signed-in device registered while `session` is valid: re-registers
 * on launch and on token rotation (when permission is granted and the user has
 * not turned notifications off), shows foreground messages as an in-app banner
 * (the OS does not), and routes a tapped notification — background tap and cold
 * start. Returns a cleanup. Mounted by usePushNotifications().
 *
 * Notification center (MH-360): an arriving push refreshes the inbox and badge
 * (bus "received"), and a tapped one — OS notification or in-app banner — marks
 * its inbox item read (data.notificationId) with this session.
 */
export function watchPush(session: string): () => void {
  const m = messaging();
  if (!m) return () => {};
  const offs: (() => void)[] = [];
  let alive = true;

  const refresh = async (token?: string) => {
    if ((await getStored(OPTOUT_KEY)) === "1") return;
    if ((await osPermission(m, false)) !== "granted") return;
    await register(session, token ?? (await fm().getToken(m)));
  };

  void refresh().catch((e) => reportError(e, "push: refresh"));

  try {
    offs.push(
      fm().onTokenRefresh(m, (token) => {
        if (alive) void refresh(token).catch((e) => reportError(e, "push: rotate"));
      }),
    );
    offs.push(
      fm().onMessage(m, async (msg: RemoteMessage) => {
        showPushBanner(bannerFrom(msg));
        emitNotify({ type: "received" });
      }),
    );
    offs.push(
      fm().onNotificationOpenedApp(m, (msg: RemoteMessage) => {
        void markReadFromPush(session, msg.data);
        openPushRoute(msg.data);
      }),
    );
  } catch (e) {
    reportError(e, "push: listen");
  }
  // The in-app banner was tapped: mark its inbox item read.
  offs.push(
    onNotify((s) => {
      if (s.type === "opened") void markReadFromPush(session, { notificationId: s.id });
    }),
  );

  // Cold start: the app was launched by tapping a notification — once per process.
  if (!coldStartHandled) {
    coldStartHandled = true;
    void fm().getInitialNotification(m)
      .then((msg) => {
        if (!msg) return;
        void markReadFromPush(session, msg.data);
        openPushRoute(msg.data);
      })
      .catch((e) => reportError(e, "push: initial"));
  }

  return () => {
    alive = false;
    offs.forEach((off) => {
      try {
        off();
      } catch {}
    });
  };
}
