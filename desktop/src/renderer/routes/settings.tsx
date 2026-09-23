import {
  Bell,
  BookOpen,
  Info,
  Lock,
  Plug,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { NoteSettingsPanel } from "@/components/notes/note-settings-panel";
import { cn } from "@/lib/utils";

import { SecuritySettings } from "../features/security";
import { AboutSettings } from "../features/settings/about";
import { AccountSettings } from "../features/settings/account";
import { ConnectSettings } from "../features/settings/connect";
import { GeneralSettings } from "../features/settings/general";
import { NotificationSettings } from "../features/settings/notifications";
import { SettingsHeader } from "../features/settings/ui";
import { useI18n, type TKey } from "../lib/i18n";
import { useRouter, type Route, type SettingsSection } from "../shell/router";
import { useSession } from "../shell/session";

/*
Settings, in sections (route: { name: "settings", section }) with a section
sidebar — the desktop form of mobile's Account tab (app/(tabs)/(account)/**).
Reachable signed out too (the API origin has to be settable before signing
in), where only the device sections show.

  general        theme, language, API origin          features/settings/general.tsx
  reading        the web's reading/editor panel (shared store with the web)
  notifications  macOS banners, sound, Dock badge     features/settings/notifications.tsx
  security       Touch ID app lock                    features/security (security team)
  account        profile, password link, delete       features/settings/account.tsx
  connect        MCP URL, install for Claude/Cursor   features/settings/connect.tsx
  about          version, updates, legal              features/settings/about.tsx
*/

type SectionDef = { id: SettingsSection; label: TKey; icon: LucideIcon; authed?: boolean; group: "prefs" | "account" | "app" };

const SECTIONS: SectionDef[] = [
  { id: "general", label: "settings.section.general", icon: SlidersHorizontal, group: "prefs" },
  { id: "reading", label: "settings.section.reading", icon: BookOpen, group: "prefs" },
  { id: "notifications", label: "settings.section.notifications", icon: Bell, authed: true, group: "prefs" },
  { id: "security", label: "settings.section.security", icon: Lock, authed: true, group: "prefs" },
  { id: "account", label: "settings.section.account", icon: UserRound, authed: true, group: "account" },
  { id: "connect", label: "settings.section.connect", icon: Plug, group: "app" },
  { id: "about", label: "settings.section.about", icon: Info, group: "app" },
];

export function SettingsRoute({ route }: { route: Extract<Route, { name: "settings" }> }) {
  const { t } = useI18n();
  const { user, token } = useSession();
  const { replace } = useRouter();
  const signedIn = Boolean(user && token);
  const sections = SECTIONS.filter((s) => !s.authed || signedIn);
  // A signed-out window asked for an account-only section: show General.
  const current = sections.some((s) => s.id === route.section) ? route.section : "general";

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label={t("settings.x.sections")} className="flex w-56 shrink-0 flex-col gap-0.5 border-e border-line p-3">
        <h2 className="grid-micro mb-2 px-2 text-grid-muted">{t("settings.title")}</h2>
        {sections.map((s, i) => {
          const Icon = s.icon;
          const gap = i > 0 && sections[i - 1].group !== s.group;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => replace({ name: "settings", section: s.id })}
              aria-current={current === s.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm transition-colors",
                gap && "mt-3",
                current === s.id ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:bg-grid-soft hover:text-grid-fg",
              )}
            >
              <Icon className={cn("size-4 shrink-0", current === s.id ? "text-grid-gold" : undefined)} />
              {t(s.label)}
            </button>
          );
        })}
      </nav>
      <ScrollArea className="grid-hatch min-h-0 flex-1">
        {/* Keyed so a section's local state (forms, fetches) starts fresh. */}
        <div key={current} className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
          <SectionBody section={current} />
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionBody({ section }: { section: SettingsSection }) {
  const { t } = useI18n();
  switch (section) {
    case "general":
      return <GeneralSettings />;
    case "reading":
      return (
        <>
          <SettingsHeader title={t("settings.section.reading")} description={t("settings.x.readingBody")} />
          <ReadingPanel />
        </>
      );
    case "notifications":
      return <NotificationSettings />;
    case "security":
      return (
        <>
          <SettingsHeader title={t("settings.section.security")} />
          <SecuritySettings />
        </>
      );
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

function ReadingPanel() {
  const { t } = useI18n();
  // Reuses the web's panel so both apps share one reading-settings store.
  return (
    <NoteSettingsPanel
      labels={{
        typography: t("reading.typography"),
        typographyHint: t("reading.typographyHint"),
        fontFamily: t("reading.fontFamily"),
        fontFamilyHint: t("reading.fontFamilyHint"),
        fontSize: t("reading.fontSize"),
        fontSizeHint: t("reading.fontSizeHint"),
        maxWidth: t("reading.maxWidth"),
        maxWidthHint: t("reading.maxWidthHint"),
        fullWidth: t("reading.fullWidth"),
        editor: t("reading.editor"),
        editorHint: t("reading.editorHint"),
        wordWrap: t("reading.wordWrap"),
        wordWrapHint: t("reading.wordWrapHint"),
        lineNumbers: t("reading.lineNumbers"),
        lineNumbersHint: t("reading.lineNumbersHint"),
        autoSave: t("reading.autoSave"),
        autoSaveHint: t("reading.autoSaveHint"),
        autoSaveOff: t("reading.autoSaveOff"),
        autoSaveBlur: t("reading.autoSaveBlur"),
        autoSaveInterval: t("reading.autoSaveInterval"),
        readingTheme: t("reading.theme"),
        readingThemeHint: t("reading.themeHint"),
        lightThemes: t("reading.lightThemes"),
        darkThemes: t("reading.darkThemes"),
        ownPalette: t("reading.ownPalette"),
      }}
    />
  );
}
