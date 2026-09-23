import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { useCommand, useCommands } from "./commands";
import { useOsEvent } from "./os-events";
import { routeFromString, useRouter } from "./router";
import { useSession } from "./session";
import { toast } from "./toast";

/*
The shell's FALLBACK handlers — the bottom of every command's stack. A screen
that knows better registers its own with useCommand and wins while mounted.

Implemented here:
  settings, sign-out, about, spotlight (-> Search route), new-note (-> open
  the active brain and hand the command to its workspace), new-brain (-> Brains),
  close-tab (-> close the window when no screen has tabs, like native apps)

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
  const { user, settings, signOut } = useSession();
  const signedIn = Boolean(user);

  useCommand("settings", () => navigate({ name: "settings", section: "general" }));
  useCommand("about", () => void bridge().showAboutPanel());
  useCommand("sign-out", () => void signOut(), signedIn);
  useCommand("spotlight", () => navigate({ name: "search" }), signedIn);
  useCommand(
    "new-note",
    () => {
      if (!settings.activeBrain) {
        navigate({ name: "brains" });
        return;
      }
      navigate({ name: "brain", ns: settings.activeBrain, tab: "notes" });
      defer("new-note");
    },
    signedIn,
  );
  // The Brains home owns the create dialog: go there and hand it the command.
  useCommand(
    "new-brain",
    () => {
      navigate({ name: "brains" });
      defer("new-brain");
    },
    signedIn,
  );
  useCommand("close-tab", () => void bridge().closeWindow());

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

  // Notification clicks carry an opaque route string (see routeFromString).
  useOsEvent("notification-click", (e) => {
    const to = e.route ? routeFromString(e.route) : null;
    if (to) navigate(to);
  });

  // TODO(feature-team): import opened markdown into the active brain. Until a
  // handler exists the file is acknowledged and PARKED (returning false), so
  // the import handler receives it when it mounts.
  useOsEvent("open-file", (f) => {
    toast(t("shell.openedFile", { name: f.name }));
    return false;
  });

  return null;
}
