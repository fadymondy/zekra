"use client";

import { XIcon } from "lucide-react";

import { noteIcon } from "@/lib/notes/note-icon";
import type { OpenTab } from "@/lib/notes/open-tabs";
import { cn } from "@/lib/utils";

/*
The open-notes tab strip (MH-218).

Deliberately hidden when fewer than two notes are open: a strip showing one tab
is chrome that explains nothing, and the note's own header already names it.

Keyboard: the strip is a tablist, so arrow keys move between tabs and the
close control is reachable by Tab. Middle-click closes, as it does in a
browser — undiscoverable on its own, which is why the × is always visible
rather than appearing on hover.
*/

export interface NoteTabsLabels {
  /** aria-label for the strip. */
  openTabs: string;
  /** Shown for a note with no title. */
  untitled: string;
  /** aria-label for a tab's close control. */
  close: string;
}

const FALLBACK_LABELS: NoteTabsLabels = {
  openTabs: "Open notes",
  untitled: "Untitled",
  close: "Close",
};

export function NoteTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  labels = FALLBACK_LABELS,
}: {
  tabs: OpenTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /**
   * Passed in rather than read from a hook: the desktop renderer has its own
   * i18n and never mounts the web I18nProvider, and useTranslations THROWS
   * without one — which would have crashed the desktop workspace at runtime
   * while compiling perfectly well.
   */
  labels?: NoteTabsLabels;
}) {
  const t = (k: keyof NoteTabsLabels) => labels[k];
  if (tabs.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label={t("openTabs")}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5 [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const { Icon: TabIcon, color: tint } = noteIcon(tab.category);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(tab.id);
              }
            }}
            onAuxClick={(e) => {
              // Middle click closes, as in a browser.
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            className={cn(
              "group flex h-7 min-w-0 max-w-52 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg ps-2.5 pe-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-nq-focus",
              active
                ? "bg-nq-selected font-medium text-foreground"
                : "text-muted-foreground hover:bg-nq-hover hover:text-foreground",
            )}
          >
            <TabIcon className="size-3.5 shrink-0" style={{ color: tint }} />
            {/* plaintext keeps a Latin title readable inside an RTL strip. */}
            <span
              className="min-w-0 flex-1 truncate"
              style={{ unicodeBidi: "plaintext" }}
            >
              {tab.title || t("untitled")}
            </span>
            <button
              type="button"
              aria-label={t("close")}
              // Without this the click also selects the tab being closed,
              // which briefly flashes it open before it disappears.
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-border hover:text-foreground group-hover:opacity-100 group-aria-selected:opacity-100 focus-visible:opacity-100"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
