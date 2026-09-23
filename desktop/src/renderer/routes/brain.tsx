import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { useI18n, type TKey } from "../lib/i18n";
import { Workspace } from "../screens/workspace";
import { useCommand } from "../shell/commands";
import { useRouter, type BrainList, type Route } from "../shell/router";
import { useAuthed } from "../shell/session";
import { WindowTitle } from "../shell/toolbar";
import { BrainPresentations } from "../features/presentations";
import { BrainVault } from "../features/vault";

/*
The Brain route: one brain, three views — Notes (the workspace),
Presentations and Vault (src/renderer/features/{presentations,vault}).
The window title is the brain, the subtitle the view (<WindowTitle>); the
views and lists are picked in the source list (shell/app-sidebar.tsx) and the
Brain menu (⌘1–3). The note tabs live inside Notes.
*/

const LIST_LABEL: Record<BrainList, TKey> = {
  all: "sb.allNotes",
  pinned: "sb.pinned",
  recent: "sb.recentNotes",
  archived: "sb.archived",
};

export function BrainRoute({ route }: { route: Extract<Route, { name: "brain" }> }) {
  const { t } = useI18n();
  const { brains, token, patch, settings } = useAuthed();
  const { navigate, replace } = useRouter();
  // Brain ▸ Notes / Presentations / Vault (⌘1 / ⌘2 / ⌘3).
  useCommand("brain:notes", () => navigate({ name: "brain", ns: route.ns, tab: "notes" }));
  useCommand("brain:presentations", () => navigate({ name: "brain", ns: route.ns, tab: "presentations" }));
  useCommand("brain:vault", () => navigate({ name: "brain", ns: route.ns, tab: "vault" }));
  const brain = brains?.find((b) => b.namespace === route.ns) ?? null;

  // Remember the open brain so the next launch returns to it.
  useEffect(() => {
    if (brain && settings.activeBrain !== brain.namespace) void patch({ activeBrain: brain.namespace });
  }, [brain, settings.activeBrain, patch]);

  // A brain that no longer exists (revoked, deleted) falls back to the list.
  useEffect(() => {
    if (brains && !brain) {
      void patch({ activeBrain: null });
      replace({ name: "brains" });
    }
  }, [brains, brain, patch, replace]);

  if (!brain) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 aria-label={t("brains.loading")} className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const name = brain.displayName || brain.namespace;
  const subtitle =
    route.tab === "notes" ? t(LIST_LABEL[route.list ?? "all"]) : route.tab === "presentations" ? t("sb.presentations") : t("sb.vault");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WindowTitle title={name} subtitle={subtitle} />

      {route.tab === "notes" ? (
        // keyed by brain: switching brains resets the editor state.
        <Workspace key={brain.namespace} token={token} brain={brain} initialNoteId={route.noteId} list={route.list ?? "all"} />
      ) : route.tab === "presentations" ? (
        // features/presentations (MH-450); keyed by brain like the workspace.
        <BrainPresentations key={brain.namespace} brain={brain} />
      ) : (
        // features/vault (MH-450): Touch ID reveal, timed hide, clipboard wipe.
        <BrainVault key={brain.namespace} brain={brain} />
      )}
    </div>
  );
}
