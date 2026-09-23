import type { AppNotification } from "@mobile/features/notify/notify-core";

import type { Route } from "../../shell/router";

/*
An inbox item's `route` ("/brain/<ns>", "/note/<id>", "/presentation/<id>"),
mapped to a desktop Route. Notes and presentations need the brain, which the
server puts in data.namespace (web/lib/notifications.ts consoleHref does the
same). Remote input: every segment is checked; anything else maps to null.
*/
const SEG = /^[A-Za-z0-9._~@-]{1,200}$/;

export function routeForNotification(n: Pick<AppNotification, "route" | "data">): Route | null {
  const m = /^\/(brain|presentation|note)\/([^/?#]+)$/.exec(n.route ?? "");
  if (!m) return null;
  let seg: string;
  try {
    seg = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!SEG.test(seg) || seg === "." || seg === "..") return null;
  const ns = n.data?.namespace ?? "";
  const nsOk = SEG.test(ns);
  switch (m[1]) {
    case "brain":
      return { name: "brain", ns: seg, tab: "notes" };
    case "presentation":
      return nsOk ? { name: "brain", ns, tab: "presentations" } : null;
    case "note":
      return nsOk ? { name: "brain", ns, tab: "notes", noteId: seg } : null;
  }
  return null;
}

/*
Native notification payloads travel as strings (window.zekra.notify route):
"zn|<notificationId>|<compact route>" where the compact route is the
router's routeFromString syntax. The agent's click handler reads it back, marks
the item read and navigates.
*/
const PREFIX = "zn|";

function compact(route: Route | null): string {
  if (!route) return "notifications";
  if (route.name === "brain") {
    return route.noteId ? `note:${route.ns}:${route.noteId}` : `brain:${route.ns}:${route.tab}`;
  }
  return "notifications";
}

export function nativeRouteFor(n: AppNotification): string {
  return `${PREFIX}${n.id}|${compact(routeForNotification(n))}`;
}

export function parseNativeRoute(s: string | undefined): { id: string | null; compact: string } | null {
  if (!s?.startsWith(PREFIX)) return null;
  const [id, ...rest] = s.slice(PREFIX.length).split("|");
  return { id: id || null, compact: rest.join("|") || "notifications" };
}
