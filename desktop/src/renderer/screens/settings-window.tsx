import { useEffect, useState } from "react";
import {
  Bell,
  BookOpen,
  Info,
  Lock,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type { SettingsSectionId } from "../../shared/ipc";
import { ZekraMark } from "../components/zekra-mark";
import { SecuritySettings } from "../features/security";
import { AboutSettings } from "../features/settings/about";
import { AccountSettings } from "../features/settings/account";
import { ConnectSettings } from "../features/settings/connect";
import { GeneralSettings } from "../features/settings/general";
import { NotificationSettings } from "../features/settings/notifications";
import { ReadingSettings } from "../features/settings/reading";
import { ServicesSettings } from "../features/settings/services";
import { SettingsHeader } from "../features/settings/ui";
import { bridge } from "../lib/bridge";
import { useI18n, type TKey } from "../lib/i18n";
import { usePlatform } from "../lib/platform";
import { useSession } from "../shell/session";
import { useWindowControls, useWindowState } from "../shell/toolbar";

/*
The Settings window (src/main/app-windows.ts showSettingsWindow) — a native
preferences window like Health Debug's (healthdebug/desktop/renderer/surfaces
/settings.tsx) and the macOS Preferences it follows: a title row naming the
section, a row of toolbar tabs (icon over label) and the section's grouped
rows below. ⌘, / every "Settings…" item / zekra://settings/<section> open
it; ⌘W or Esc closes it. Reachable signed out (to point the app at another
API before signing in) with the device-only sections.

  general        appearance (light/dark/system), language, API origin
  reading        reading theme, typography, editor        features/settings/reading.tsx
  notifications  banners, sound, Dock badge
  security       Touch ID app lock
  services       sync & offline, Quick Capture, Search shortcut, startup
  account        profile, password, sign out, delete
  connect        MCP URL, install for Claude Code / Cursor
  about          version, Software Update, legal          features/settings/about.tsx
*/

type SectionDef = { id: SettingsSectionId; label: TKey; icon: LucideIcon; authed?: boolean };

const SECTIONS: SectionDef[] = [
  { id: "general", label: "settings.section.general", icon: SlidersHorizontal },
  { id: "reading", label: "settings.section.reading", icon: BookOpen },
  { id: "notifications", label: "settings.section.notifications", icon: Bell, authed: true },
  { id: "security", label: "settings.section.security", icon: Lock, authed: true },
  { id: "services", label: "win.section.services", icon: RefreshCw },
  { id: "account", label: "settings.section.account", icon: UserRound, authed: true },
  { id: "connect", label: "settings.section.connect", icon: Plug },
  { id: "about", label: "settings.section.about", icon: Info },
];

export function SettingsWindow({ initial }: { initial: SettingsSectionId | null }) {
  const { t } = useI18n();
  const { user, token } = useSession();
  const { platform } = usePlatform();
  const controls = useWindowControls();
  const win = useWindowState();
  const [section, setSection] = useState<SettingsSectionId>(initial ?? "general");
  const signedIn = Boolean(user && token);
  const sections = SECTIONS.filter((s) => !s.authed || signedIn);
  const current = sections.find((s) => s.id === section) ?? sections[0];

  // A deep link / "Account Settings…" while the window is already open.
  useEffect(() => bridge().onSettingsSection?.((s) => setSection(s)), []);
  useEffect(() => {
    document.title = `${t("settings.title")} — ${t(current.label)}`;
  }, [t, current.label]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-open][role=dialog], [data-slot=select-content]")) void bridge().closeWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const captions = platform === "win32" && controls.side === "right" ? controls.inset : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="settings-toolbar app-drag app-chrome shrink-0" data-blurred={!win.focused}>
        <div className="settings-title flex items-center justify-center gap-2" style={captions ? { paddingRight: captions } : undefined}>
          {platform === "win32" ? <ZekraMark size={16} className="absolute start-3" /> : null}
          <span className="truncate">{t(current.label)}</span>
        </div>
        <nav role="tablist" aria-label={t("settings.x.sections")} className="flex flex-wrap justify-center gap-0.5 px-3 pb-2">
          {sections.map((s) => {
            const Icon = s.icon;
            const on = s.id === current.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-active={on || undefined}
                onClick={() => setSection(s.id)}
                className="settings-tab"
              >
                <Icon aria-hidden />
                <span>{t(s.label)}</span>
              </button>
            );
          })}
        </nav>
      </header>
      <ScrollArea className="min-h-0 flex-1 bg-background">
        {/* Keyed so a section's local state (forms, fetches) starts fresh. */}
        <div key={current.id} className={cn("mx-auto flex w-full max-w-[660px] flex-col gap-6 px-7 pt-5 pb-8")}>
          <SectionBody section={current.id} />
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionBody({ section }: { section: SettingsSectionId }) {
  const { t } = useI18n();
  switch (section) {
    case "general":
      return <GeneralSettings />;
    case "reading":
      return <ReadingSettings />;
    case "notifications":
      return <NotificationSettings />;
    case "security":
      return (
        <>
          <SettingsHeader title={t("settings.section.security")} />
          <SecuritySettings />
        </>
      );
    case "services":
      return <ServicesSettings />;
    case "account":
      return <AccountSettings />;
    case "connect":
      return <ConnectSettings />;
    case "about":
      return <AboutSettings />;
    default: {
      const never: never = section;
      return never;
    }
  }
}
