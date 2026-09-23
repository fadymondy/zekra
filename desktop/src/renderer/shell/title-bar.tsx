import { useEffect, useState } from "react";
import { Bell, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { ZekraMark } from "../components/zekra-mark";
import { bridge, type AppInfo, type WindowStateEvent } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { AccountMenu } from "./account-menu";
import { useRunCommand } from "./commands";
import { useRouter } from "./router";
import { Slot } from "./slots";

/*
The macOS title bar, drawn by the renderer (titleBarStyle "hiddenInset").

  [ traffic-light inset | titlebar.start ]  [ ⌘K search pill ]  [ titlebar.end | bell | account ]

- 44px tall; the window's traffic lights are positioned inside it by main
  (trafficLightPosition), and the first 80px on the PHYSICAL left are left
  empty for them — also in Arabic, because macOS does not mirror window
  controls with the app's locale. In full screen the lights are hidden, so the
  inset collapses.
- The whole bar is a drag region; every control opts out with .app-no-drag.
- Unfocused windows dim the chrome, like native title bars.
*/

export const TITLEBAR_HEIGHT = 44;

export function useWindowState(): WindowStateEvent {
  const [state, setState] = useState<WindowStateEvent>({ focused: true, fullscreen: false, maximized: false });
  useEffect(() => bridge().onWindowState(setState), []);
  return state;
}

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void bridge().getAppInfo().then(setInfo);
  }, []);
  return info;
}

export function TitleBar({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const run = useRunCommand();
  const info = useAppInfo();
  const win = useWindowState();
  const inset = info && !win.fullscreen ? info.windowControls.inset : 0;
  const controlsLeft = info?.windowControls.side !== "right";

  return (
    <header
      className="app-drag relative flex shrink-0 items-center gap-2 border-b border-line bg-grid-bg pe-2 ps-2 transition-opacity data-[blurred=true]:opacity-70"
      data-blurred={!win.focused}
      style={{
        height: TITLEBAR_HEIGHT,
        // Physical, not logical: the traffic lights do not flip with dir=rtl.
        ...(controlsLeft ? { paddingLeft: inset || undefined } : { paddingRight: inset || undefined }),
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ZekraMark size={18} className="shrink-0" />
        <Slot name="titlebar.start" />
      </div>

      {/* Centred on the WINDOW, not on the space between the side groups. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        {signedIn ? (
          <button
            type="button"
            onClick={() => run("spotlight")}
            className="app-no-drag pointer-events-auto flex h-7 w-[min(420px,40vw)] items-center gap-2 rounded-md border border-line bg-grid-card px-2.5 text-start text-xs text-grid-muted transition-colors hover:bg-grid-soft focus-visible:outline-2 focus-visible:outline-grid-action"
            aria-label={t("shell.search")}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("shell.search")}</span>
            <KbdGroup className="gap-0.5">
              <Kbd className="w-5 min-w-auto">⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </button>
        ) : (
          <span className="text-xs font-medium text-grid-muted">{t("app.name")}</span>
        )}
      </div>

      <div className="app-no-drag relative ms-auto flex items-center gap-1">
        <Slot name="titlebar.end" />
        {signedIn ? (
          <>
            <Slot name="titlebar.bell" fallback={<DefaultBell />} />
            <Slot name="titlebar.account" fallback={<AccountMenu />} />
          </>
        ) : null}
      </div>
    </header>
  );
}

/** Placeholder bell until the notifications feature publishes its own into
 *  the "titlebar.bell" slot (web/components/shell/notification-bell.tsx is the
 *  reference). */
function DefaultBell() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  return (
    <Button variant="ghost" size="icon-sm" aria-label={t("nav.notifications")} onClick={() => navigate({ name: "notifications" })}>
      <Bell />
    </Button>
  );
}
