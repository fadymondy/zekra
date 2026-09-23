import { useEffect } from "react";

import { SETTINGS_SECTIONS, type SettingsSectionId } from "../../shared/ipc";
import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { useCommand, useCommands } from "./commands";
import { useOsEvent } from "./os-events";
import { routeFromString, useRouter } from "./router";
import { useSession } from "./session";
import { toast } from "./toast";
import { exportBrain } from "../features/brains/brains-data";
import { notifyStore } from "../features/notify/store";


/*
The shell's FALLBACK handlers — the bottom of every command's stack. A screen
that knows better registers its own with useCommand and wins while mounted.

Implemented here:
  settings / spotlight / new-note / new-brain  -> their own windows (main
      process app-windows.ts; the menu opens them directly, these cover
      in-app buttons). The browser preview has no windows: it falls back to
      the Search route / the workspace's draft tab.
  go:inbox, "notifications" routes            -> the bell's popover
  sign-out, about, close-tab (-> close the window when no screen has tabs)

Typed no-ops for the feature teams — each is a TODO(feature-team):
  reopen-tab, next-tab, prev-tab   note tabs (screens/workspace.tsx owns tabs)
  toggle-sidebar, toggle-outline   workspace layout
  find                             find-in-note
  import:*                         Apple Notes / Google Keep / Notion / folder
  export:*                         md, html, pdf (window.zekra.printToPdf),
                                   docx, png, txt (window.zekra.saveFile)
*/
export function ShellCommands() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const { defer } = useCommands();
  const { user, settings, signOut, token, reloadBrains, patch } = useSession();
  const signedIn = Boolean(user);
  const b = bridge();

  useCommand("settings", () => void b.openSettingsWindow?.("general"));
  useCommand("about", () => void bridge().showAboutPanel());
  useCommand("sign-out", () => void signOut(), signedIn);
  useCommand("spotlight", () => (b.openSpotlight ? void b.openSpotlight() : navigate({ name: "search" })), signedIn);
  useCommand(
    "new-note",
    () => {
      if (b.openNewNoteWindow) {
        void b.openNewNoteWindow(settings.activeBrain);
        return;
      }
      if (!settings.activeBrain) {
        navigate({ name: "brains" });
        return;
      }
      navigate({ name: "brain", ns: settings.activeBrain, tab: "notes" });
      defer("new-note");
    },
    signedIn,
  );
  useCommand("new-brain", () => void b.openNewBrainWindow?.(), signedIn);
  useCommand("close-tab", () => void bridge().closeWindow());

  // Go ▸ … and Brain ▸ … (the Brain route overrides brain:* for the open brain).
  const { back } = useRouter();
  useCommand("go:back", () => back());
  useCommand("go:brains", () => navigate({ name: "brains" }), signedIn);
  useCommand("go:search", () => navigate({ name: "search" }), signedIn);
  useCommand("go:inbox", () => notifyStore.setOpen(true), signedIn);
  const toBrain = (tab: "notes" | "presentations" | "vault") => () =>
    settings.activeBrain ? navigate({ name: "brain", ns: settings.activeBrain, tab }) : navigate({ name: "brains" });
  useCommand("brain:notes", toBrain("notes"), signedIn);
  useCommand("brain:presentations", toBrain("presentations"), signedIn);
  useCommand("brain:vault", toBrain("vault"), signedIn);
  useCommand(
    "brain:export",
    () => {
      if (!settings.activeBrain || !token) return;
      void exportBrain(token, settings.activeBrain)
        .then((path) => path && toast.success(t("brainsx.exported", { name: path.split(/[\\/]/).pop() ?? path })))
        .catch(() => toast.error(t("brains.export.failed")));
    },
    signedIn,
  );
  // Owned by the notes workspace / a note window while one is focused.
  for (const name of ["toggle-list", "open-in-new-window", "note:pin", "note:archive", "note:appearance", "note:versions", "note:rename", "note:view-source", "note:copy", "note:delete"] as const) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed list, fixed order
    useCommand(name, () => undefined);
  }

  // TODO(feature-team): implement; registered so the menu items are typed and discoverable.
  const soon = () => {
    toast(t("shell.comingSoon"), { description: t("shell.comingSoonBody") });
  };
  useCommand("reopen-tab", () => undefined);
  useCommand("next-tab", () => undefined);
  useCommand("prev-tab", () => undefined);
  useCommand("toggle-sidebar", () => undefined);
  useCommand("toggle-outline", () => undefined);
  useCommand("find", () => undefined);
  useCommand("import:apple-notes", soon);
  useCommand("import:google-keep", soon);
  useCommand("import:notion", soon);
  useCommand("import:markdown-folder", soon);
  useCommand("export:md", soon);
  useCommand("export:html", soon);
  useCommand("export:pdf", soon);
  useCommand("export:docx", soon);
  useCommand("export:png", soon);
  useCommand("export:txt", soon);

  // Notification clicks (and the tray / Spotlight's openInMain) carry an
  // opaque route string (see routeFromString). "notifications" is the bell's
  // popover, "settings[:section]" the Settings window.
  useOsEvent("notification-click", (e) => {
    const r = e.route ?? "";
    if (r === "notifications") {
      if (signedIn) notifyStore.setOpen(true);
      return;
    }
    if (r === "settings" || r.startsWith("settings:")) {
      const section = r.split(":")[1] as SettingsSectionId | undefined;
      void b.openSettingsWindow?.(section && (SETTINGS_SECTIONS as readonly string[]).includes(section) ? section : "general");
      return;
    }
    const to = r ? routeFromString(r) : null;
    if (to) navigate(to);
  });

  // A brain created in the New Brain window: reload, then open it here.
  useEffect(
    () =>
      b.onBroadcast?.((msg) => {
        if (msg.kind !== "brains-changed") return;
        void reloadBrains().then(() => {
          if (!msg.open) return;
          void patch({ activeBrain: msg.open });
          navigate({ name: "brain", ns: msg.open, tab: "notes" });
        });
      }),
    [b, reloadBrains, patch, navigate],
  );

  // TODO(feature-team): import opened markdown into the active brain. Until a
  // handler exists the file is acknowledged and PARKED (returning false), so
  // the import handler receives it when it mounts.
  useOsEvent("open-file", (f) => {
    toast(t("shell.openedFile", { name: f.name }));
    return false;
  });

  return null;
}
