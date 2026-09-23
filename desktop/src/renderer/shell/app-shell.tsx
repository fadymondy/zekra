import { useCallback, useState, type CSSProperties } from "react";
import { Loader2 } from "lucide-react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { NotifyAgent } from "../features/notify/agent"; // MH-450: polling, OS banners, Dock badge
import { useI18n } from "../lib/i18n";
import { RouteView } from "../routes";
import { SettingsRoute } from "../routes/settings";
import { SignInScreen } from "../screens/sign-in";
import { AppSidebar, SIDEBAR_WIDTH } from "./app-sidebar";
import { useCommand } from "./commands";
import { useRouter } from "./router";
import { useSession } from "./session";
import { StatusBar } from "./status-bar";
import { Toolbar, ToolbarProvider, WindowsTitleBar, WindowTitle } from "./toolbar";
import { usePlatform } from "../lib/platform";

/*
The window layout (macOS, signed in) — a source list and one content pane:

  ┌ AppSidebar (vibrancy) ┬──────────── Toolbar (52px, the title bar) ───────────┐
  │ ● ● ●             ▢   │ ▢ ‹  Brain ▸ Notes | Presentations | Vault   ⌕ ⌘K    │
  │ Search                ├───────────────────────────────────────────────────────┤
  │ Notifications      2  │                                                       │
  │ All brains            │               <RouteView route={route} />             │
  │ BRAINS            +   │                                                       │
  │  ◉ Royal Legal        │                                                       │
  │ RECENT NOTES          ├───────────────────────────────────────────────────────┤
  │ Settings · account    │ status line (only while a screen publishes one)       │
  └───────────────────────┴───────────────────────────────────────────────────────┘

The sidebar is the shadcn Sidebar (web/components/ui/sidebar.tsx), collapsible
with ⌘\ (View menu → "toggle-sidebar") and resizable; both persist.
Signed out: the sign-in screen (or Settings, which must be reachable before
signing in to point the app at another API).

Where feature teams plug in — shell/toolbar.tsx (<ToolbarTitle>,
<ToolbarActions>), shell/slots.tsx (titlebar.end, status line),
shell/app-sidebar.tsx (navigation), shell/router.tsx Route (screens),
shell/commands.tsx useCommand (menu commands), shell/os-events.tsx useOsEvent.
*/

const PREFS = "zekra.desktop.shell";
type ShellPrefs = { open: boolean; width: number };
function loadPrefs(): ShellPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<ShellPrefs>;
    const width = typeof p.width === "number" ? Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, p.width)) : SIDEBAR_WIDTH.initial;
    return { open: p.open ?? true, width };
  } catch {
    return { open: true, width: SIDEBAR_WIDTH.initial };
  }
}
function savePrefs(p: ShellPrefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* non-fatal */
  }
}

export function AppShell({ booting, onSignedIn }: { booting: boolean; onSignedIn: Parameters<typeof SignInScreen>[0]["onSignedIn"] }) {
  const { user, token } = useSession();
  const signedIn = Boolean(user && token);
  return (
    <ToolbarProvider>
      {booting ? <Booting /> : signedIn ? <SignedIn /> : <SignedOut onSignedIn={onSignedIn} />}
    </ToolbarProvider>
  );
}

function SignedIn() {
  const { route } = useRouter();
  const [prefs, setPrefs] = useState<ShellPrefs>(loadPrefs);
  const [liveWidth, setLiveWidth] = useState(prefs.width);
  const { platform } = usePlatform();

  const setOpen = useCallback((open: boolean) => {
    setPrefs((p) => {
      const next = { ...p, open };
      savePrefs(next);
      return next;
    });
  }, []);
  const commitWidth = useCallback((width: number) => {
    setPrefs((p) => {
      const next = { ...p, width };
      savePrefs(next);
      return next;
    });
  }, []);

  useCommand("toggle-sidebar", () => setOpen(!prefs.open));

  return (
    <SidebarProvider
      open={prefs.open}
      onOpenChange={setOpen}
      keyboardShortcut={false} // ⌘B is bold in the editor; the sidebar is ⌥⌘S / ⌘\ from the View menu
      className="h-full min-h-0 flex-col"
      style={{ "--sidebar-width": `${liveWidth}px` } as CSSProperties}
    >
      <NotifyAgent />
      {platform === "win32" ? <WindowsTitleBar /> : null}
      <div className="flex min-h-0 w-full flex-1">
        <AppSidebar width={liveWidth} onWidth={setLiveWidth} onWidthDone={commitWidth} />
        <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
          <Toolbar />
          <div className="flex min-h-0 flex-1 flex-col bg-background">
            <RouteView route={route} />
          </div>
          <StatusBar />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function SignedOut({ onSignedIn }: { onSignedIn: Parameters<typeof SignInScreen>[0]["onSignedIn"] }) {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  if (route.name === "settings") {
    return (
      <SidebarProvider open={false} keyboardShortcut={false} className="h-full min-h-0">
        <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
          <Toolbar sidebar={false} search={false} />
          <WindowTitle title={t("settings.title")} />
          <div className="flex min-h-0 flex-1 flex-col bg-background">
            <SettingsRoute route={route} />
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }
  return (
    <div className="relative flex h-full flex-col bg-background">
      <div aria-hidden className="app-drag absolute inset-x-0 top-0" style={{ height: "var(--titlebar-h)" }} />
      <SignInScreen onSignedIn={onSignedIn} onOpenSettings={() => navigate({ name: "settings", section: "general" })} />
    </div>
  );
}

function Booting() {
  const { t } = useI18n();
  return (
    <div className="relative flex h-full items-center justify-center bg-background">
      <div aria-hidden className="app-drag absolute inset-x-0 top-0" style={{ height: "var(--titlebar-h)" }} />
      <Loader2 aria-label={t("brains.loading")} className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}
