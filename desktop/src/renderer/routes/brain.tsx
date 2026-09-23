import { useEffect } from "react";

import { cn } from "@/lib/utils";

import { BrainAvatar } from "../components/brain-avatar";
import { useI18n } from "../lib/i18n";
import { Workspace } from "../screens/workspace";
import { useRouter, type BrainTab, type Route } from "../shell/router";
import { useAuthed } from "../shell/session";
import { BrainPresentations } from "../features/presentations";
import { BrainVault } from "../features/vault";

/*
The Brain route: one brain, three tabs — Notes (the existing workspace),
Presentations and Vault (src/renderer/features/{presentations,vault}).
The tab strip is the route's own header; the note tabs live inside Notes.
*/
export function BrainRoute({ route }: { route: Extract<Route, { name: "brain" }> }) {
  const { t } = useI18n();
  const { brains, token, patch, settings } = useAuthed();
  const { navigate, replace } = useRouter();
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
    return <div className="grid-hatch flex flex-1 items-center justify-center text-sm text-grid-muted">{t("brains.loading")}</div>;
  }

  const tabs: { id: BrainTab; label: string }[] = [
    { id: "notes", label: t("brain.tab.notes") },
    { id: "presentations", label: t("brain.tab.presentations") },
    { id: "vault", label: t("brain.tab.vault") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-grid-bg px-3">
        <BrainAvatar brain={brain} token={token} size={22} />
        <span className="truncate text-sm font-medium" style={{ unicodeBidi: "plaintext" }}>
          {brain.displayName || brain.namespace}
        </span>
        <div role="tablist" className="ms-4 flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={route.tab === tab.id}
              onClick={() => navigate({ name: "brain", ns: brain.namespace, tab: tab.id })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                route.tab === tab.id ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {route.tab === "notes" ? (
        // keyed by brain: switching brains resets the editor state.
        <Workspace key={brain.namespace} token={token} brain={brain} initialNoteId={route.noteId} />
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
