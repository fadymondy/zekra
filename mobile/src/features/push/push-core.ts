// Pure push logic (MH-373): no React Native imports, so `node --test` can
// exercise it directly (push-core.test.ts).

/** What the notification settings row shows. */
export type PushState = "on" | "off" | "denied" | "unavailable";

/** The OS answer about notification permission. */
export type OsPermission = "granted" | "undetermined" | "denied";

export function derivePushState(opts: {
  /** A native Firebase app is configured in this build. */
  available: boolean;
  permission: OsPermission;
  /** The user turned notifications off in the app. */
  optedOut: boolean;
  /** This device's token is registered with the server. */
  registered: boolean;
}): PushState {
  if (!opts.available) return "unavailable";
  if (opts.permission === "denied") return "denied";
  if (opts.permission === "granted" && !opts.optedOut && opts.registered) return "on";
  return "off";
}

// Routes a notification may open. Anything else in a payload is ignored: a
// push is remote input, and must not be able to navigate the app anywhere.
// Not "." or ".." — a dot segment would resolve relative to the current route.
const ID = "(?!\\.{1,2}$)[A-Za-z0-9_.:-]{1,128}";
const ROUTES = [
  new RegExp(`^/note/${ID}$`),
  new RegExp(`^/presentation/${ID}$`),
  // Brain namespaces arrive percent-encoded (the server uses url.PathEscape).
  /^\/brain\/(?!\.{1,2}$)(?:[A-Za-z0-9_.~:@!$&'()*+,;=-]|%[0-9A-Fa-f]{2}){1,200}$/,
];

function isAllowedRoute(route: string): boolean {
  return ROUTES.some((re) => re.test(route));
}

/**
 * The in-app route a notification's data block points at, or null.
 * Primary: data.route ("/note/<id>" | "/brain/<ns>" | "/presentation/<id>").
 * Fallback: the typed ids the server also sends.
 */
export function routeFromData(data: Record<string, unknown> | undefined | null): string | null {
  if (!data) return null;
  const route = typeof data.route === "string" ? data.route.trim() : "";
  if (route && isAllowedRoute(route)) return route;
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
  const candidates = [
    str("note_id") && `/note/${str("note_id")}`,
    str("presentation_id") && `/presentation/${str("presentation_id")}`,
    str("namespace") && `/brain/${encodeURIComponent(str("namespace"))}`,
  ];
  for (const c of candidates) if (c && isAllowedRoute(c)) return c;
  return null;
}

export type PushBanner = {
  id: number;
  title: string;
  body: string;
  route: string | null;
  /** The inbox item the push is (data.notificationId, MH-360): tapping marks it read. */
  notificationId: string | null;
};

type RemoteLike = {
  messageId?: string;
  notification?: { title?: string | null; body?: string | null } | null;
  data?: Record<string, unknown> | null;
};

let bannerSeq = 0;

/** A foreground message as the in-app banner shows it. */
export function bannerFrom(msg: RemoteLike, fallbackTitle = "Zekra"): PushBanner {
  const title = (msg.notification?.title ?? "").trim() || (typeof msg.data?.title === "string" ? msg.data.title : "") || fallbackTitle;
  const body = (msg.notification?.body ?? "").trim() || (typeof msg.data?.body === "string" ? msg.data.body : "");
  const nid = msg.data?.notificationId;
  return {
    id: ++bannerSeq,
    title: title.slice(0, 120),
    body: body.slice(0, 300),
    route: routeFromData(msg.data ?? undefined),
    notificationId: typeof nid === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(nid) ? nid : null,
  };
}

/** Sent as user_agent when registering: app build and OS, nothing personal. */
export function pushUserAgent(os: string, osVersion: string | number, appVersion: string, build: string): string {
  return `zekra-mobile/${appVersion || "0"} (${build || "dev"}) ${os} ${osVersion}`.slice(0, 300);
}

/** "ar-EG" / "ar" → "ar"; everything else → "en" (the server's two languages). */
export function pushLocale(tag: string | null | undefined): "en" | "ar" {
  return (tag ?? "").toLowerCase().startsWith("ar") ? "ar" : "en";
}
