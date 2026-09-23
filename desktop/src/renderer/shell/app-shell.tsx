import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useI18n } from "../lib/i18n";
import { RouteView } from "../routes";
import { SettingsRoute } from "../routes/settings";
import { SignInScreen } from "../screens/sign-in";
import { NotifyAgent } from "../features/notify/agent"; // MH-450: bell slot, polling, OS banners, Dock badge
import { ActivityBar } from "./activity-bar";
import { useRouter } from "./router";
import { useSession } from "./session";
import { StatusBar } from "./status-bar";
import { TitleBar } from "./title-bar";

/*
The window layout. Signed in:

  ┌──────────────────────── TitleBar (44px) ────────────────────────┐
  │ Activity │                                                      │
  │   bar    │              <RouteView route={route} />             │
  │  (52px)  │                                                      │
  ├──────────────────────── StatusBar (24px) ───────────────────────┤

Signed out: the title bar and the sign-in screen (or Settings, which must be
reachable before signing in to point the app at another API).

Where feature teams plug in — see shell/slots.tsx (title bar / status bar
items), shell/activity-bar.tsx ACTIVITY_ITEMS (nav entries), shell/router.tsx
Route (screens), shell/commands.tsx useCommand (menu commands),
shell/os-events.tsx useOsEvent (deep links, opened files, notification clicks).
*/
export function AppShell({ booting, onSignedIn }: { booting: boolean; onSignedIn: Parameters<typeof SignInScreen>[0]["onSignedIn"] }) {
  const { t, isRtl } = useI18n();
  const { user, token } = useSession();
  const { route, navigate, back, canGoBack } = useRouter();
  const signedIn = Boolean(user && token);

  let body;
  if (booting) {
    body = <div className="grid-hatch flex flex-1 items-center justify-center text-sm text-grid-muted">{t("brains.loading")}</div>;
  } else if (!signedIn) {
    body =
      route.name === "settings" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-line px-2">
            <Button variant="ghost" size="sm" onClick={() => (canGoBack ? back() : navigate({ name: "brains" }))}>
              {isRtl ? <ArrowRight /> : <ArrowLeft />}
              {t("nav.back")}
            </Button>
          </div>
          <SettingsRoute route={route} />
        </div>
      ) : (
        <SignInScreen onSignedIn={onSignedIn} onOpenSettings={() => navigate({ name: "settings", section: "general" })} />
      );
  } else {
    body = (
      <div className="flex min-h-0 flex-1">
        <NotifyAgent />
        <ActivityBar />
        <main className="flex min-w-0 flex-1 flex-col">
          <RouteView route={route} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar signedIn={signedIn} />
      {body}
      {signedIn ? <StatusBar /> : null}
    </div>
  );
}
