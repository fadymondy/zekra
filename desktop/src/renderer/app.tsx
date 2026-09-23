import { useCallback, useEffect, useMemo, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ApiError, authApi, setApiBaseUrl, zekraApi, type AuthAnswer, type Brain, type User } from "./lib/api";
import { clearAuthedImageCache } from "./lib/authed-image";
import { bridge, type AppSettings, type SettingsPatch, type ThemeChoice } from "./lib/bridge";
import { I18nProvider } from "./lib/i18n";
import { loadPlatform, syncWindowChrome, windowKind } from "./lib/platform";
import { installAppearanceSync } from "./lib/appearance";
import { NoteWindow } from "./screens/note-window";
import { NewBrainWindow } from "./screens/new-brain-window";
import { SettingsWindow } from "./screens/settings-window";
import { SpotlightWindow } from "./screens/spotlight-window";
import { TrayStateSync } from "./shell/tray-state";
import { AppLockGate } from "./features/security"; // MH-450 Touch ID app lock
import { MarkItDownFeatures } from "./features/open-file/host"; // MH-450 importers, opened .md, tray, updates
import { AppShell } from "./shell/app-shell";
import { ShellCommands } from "./shell/base-commands";
import { CommandProvider } from "./shell/commands";
import { OsEventsProvider } from "./shell/os-events";
import { RouterProvider, type Route } from "./shell/router";
import { SessionProvider, type Session } from "./shell/session";
import { SlotProvider } from "./shell/slots";
import { toast, Toaster } from "./shell/toast";

/*
Root: loads local settings, restores the session, and composes the providers
the shell and every screen rely on:

  I18nProvider      t(), locale, <html lang/dir>
  SessionProvider   settings, user/token, brains, signOut  (shell/session.tsx)
  RouterProvider    typed routes                            (shell/router.tsx)
  CommandProvider   menu/tray command bus                   (shell/commands.tsx)
  OsEventsProvider  deep links, opened files, notif clicks  (shell/os-events.tsx)
  SlotProvider      title/status bar slots                  (shell/slots.tsx)
*/

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** main sets nativeTheme.themeSource from the same setting, so for "system"
 *  prefers-color-scheme already reflects macOS. */
export function resolveTheme(theme: ThemeChoice): "light" | "dark" {
  return theme === "system" ? (prefersDark() ? "dark" : "light") : theme;
}

export function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  syncWindowChrome();
}


function initialRoute(settings: AppSettings): Route {
  return settings.activeBrain ? { name: "brain", ns: settings.activeBrain, tab: "notes" } : { name: "brains" };
}

const kind = windowKind();
document.documentElement.dataset.window = kind.kind;

function Root({ settings, setSettings }: { settings: AppSettings; setSettings: (s: AppSettings) => void }) {
  const [user, setUser] = useState<User | null>(settings.authToken ? settings.authUser : null);
  const [brains, setBrains] = useState<Brain[] | null>(null);
  const [booting, setBooting] = useState(Boolean(settings.authToken));
  const [version, setVersion] = useState("");
  const [systemDark, setSystemDark] = useState(prefersDark);
  const token = settings.authToken;

  const patch = useCallback(
    async (p: SettingsPatch) => {
      const next = await bridge().patchSettings(p);
      setSettings(next);
      return next;
    },
    [setSettings],
  );

  // Theme: follow the setting, and macOS while it is "system".
  const resolvedTheme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  useEffect(() => applyTheme(resolvedTheme), [resolvedTheme]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    const off = bridge().onSystemThemeChanged(() => setSystemDark(prefersDark()));
    return () => {
      mq.removeEventListener("change", onChange);
      off();
    };
  }, []);

  // Appearance (reading theme + typography) is live in every window.
  useEffect(() => installAppearanceSync(), []);

  // Another window changed the settings (theme, language, the session: a
  // sign-out in the Settings window signs this window out too).
  useEffect(
    () =>
      bridge().onSettingsChanged?.((next) => {
        setSettings(next);
        if (!next.authToken) {
          setUser(null);
          setBrains(null);
        }
      }),
    [setSettings],
  );

  const loadBrains = useCallback(async (tok: string) => {
    try {
      const { brains: list } = await zekraApi.brains(tok);
      setBrains(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load brains");
    }
  }, []);

  // A brain was created elsewhere: the pickers (Spotlight, New Note) follow.
  // The main window reloads and opens it itself (shell/base-commands.tsx).
  useEffect(
    () =>
      bridge().onBroadcast?.((msg) => {
        if (msg.kind === "brains-changed" && kind.kind !== "main" && token) void loadBrains(token);
      }),
    [token, loadBrains],
  );

  // Restore the session on boot / token change. Only an auth rejection signs
  // the user out — being offline must not.
  useEffect(() => {
    let alive = true;
    void bridge().getVersion().then((v) => alive && setVersion(v));
    if (!token) {
      setBooting(false);
      return;
    }
    void (async () => {
      try {
        const me = await authApi.me(token);
        const resolved = (me as { user?: User }).user ?? (me as User);
        if (alive && resolved?.id) setUser(resolved);
        if (alive) await loadBrains(token);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          const fresh = await bridge().clearSession();
          if (alive) {
            setSettings(fresh);
            setUser(null);
          }
        } else if (alive) {
          toast.error(e instanceof Error ? e.message : "Could not reach Zekra");
        }
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, setSettings, loadBrains]);

  const signIn = useCallback(
    async (answer: AuthAnswer) => {
      const next = await patch({ authToken: answer.token, authUser: answer.user });
      setUser(answer.user);
      if (next.authToken) await loadBrains(next.authToken);
    },
    [patch, loadBrains],
  );

  const signOut = useCallback(async () => {
    if (token) await authApi.logout(token).catch(() => undefined);
    const fresh = await bridge().clearSession();
    clearAuthedImageCache();
    setSettings(fresh);
    setUser(null);
    setBrains(null);
  }, [token, setSettings]);

  const session = useMemo<Session>(
    () => ({
      settings,
      patch,
      user,
      token,
      brains,
      reloadBrains: () => (token ? loadBrains(token) : Promise.resolve()),
      signOut,
      resolvedTheme,
      version,
    }),
    [settings, patch, user, token, brains, loadBrains, signOut, resolvedTheme, version],
  );

  return (
    <SessionProvider value={session}>
      {/* Re-keyed per account: signing in/out starts navigation afresh. */}
      <RouterProvider key={user?.id ?? "signed-out"} initial={user ? initialRoute(settings) : { name: "brains" }}>
        <CommandProvider>
          <OsEventsProvider announceReady={kind.kind === "main"}>
            <SlotProvider>
              <TooltipProvider delay={400}>
                {kind.kind === "note" ? (
                  // A note document window (src/main/native-ui.ts).
                  <NoteWindow ns={kind.ns} id={kind.id} />
                ) : kind.kind === "note-new" ? (
                  // File ▸ New Note / the tray: a new note, brain picker on top.
                  <NoteWindow ns={kind.ns} id={null} />
                ) : kind.kind === "settings" ? (
                  <SettingsWindow initial={kind.section} />
                ) : kind.kind === "spotlight" ? (
                  <SpotlightWindow />
                ) : kind.kind === "new-brain" ? (
                  <NewBrainWindow />
                ) : (
                  <>
                    <ShellCommands />
                    <MarkItDownFeatures />
                    <TrayStateSync />
                    <AppShell booting={booting} onSignedIn={(a) => void signIn(a)} />
                  </>
                )}
                <Toaster theme={resolvedTheme} />
                <AppLockGate />
              </TooltipProvider>
            </SlotProvider>
          </OsEventsProvider>
        </CommandProvider>
      </RouterProvider>
    </SessionProvider>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void (async () => {
      const [s] = await Promise.all([bridge().getSettings(), loadPlatform()]);
      setApiBaseUrl(s.apiBaseUrl);
      applyTheme(resolveTheme(s.theme));
      setSettings(s);
    })();
  }, []);

  if (!settings) return null; // the window is not shown until ready-to-show

  return (
    <I18nProvider initial={settings.locale ?? "en"} onChange={(next) => void bridge().patchSettings({ locale: next })}>
      <Root settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}
