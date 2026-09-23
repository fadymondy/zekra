import { useState, type DragEvent } from "react";
import { Columns2, X } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { noteIcon } from "@/lib/notes/note-icon";
import { cn } from "@/lib/utils";

import { NOTE_DRAG_MIME } from "../../components/note-row";
import { useI18n } from "../../lib/i18n";
import type { DeskTab } from "./tab-groups";

/*
One editor group's tab strip. Always shown (unlike the web's, which hides
below two tabs): on the desktop it is also the drop target that opens a
dragged note in this group, and it carries the split button.

  click          select        middle-click / ×   close
  drag           reorder, or move to the other group's strip
  drop a note    (from the sidebar) open it here
  right-click    close · close others · move to the other side / split

The unsaved dot replaces the × until hovered, as in native editors.
*/

export const TAB_DRAG_MIME = "application/x-zekra-tab";

export type DroppedNote = { id: string; title: string; category?: string; icon?: string; color?: string };

export function TabStrip({
  group,
  groups,
  tabs,
  active,
  focused,
  dirty,
  onSelect,
  onClose,
  onCloseOthers,
  onMove,
  onDropNote,
  onSplit,
  onUnsplit,
}: {
  group: number;
  groups: number;
  tabs: DeskTab[];
  active: string | null;
  focused: boolean;
  dirty: Set<string>;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onCloseOthers: (key: string) => void;
  onMove: (key: string, toGroup: number, beforeKey: string | null) => void;
  onDropNote: (note: DroppedNote, group: number, beforeKey: string | null) => void;
  onSplit: (key?: string) => void;
  onUnsplit: () => void;
}) {
  const { t } = useI18n();
  const [over, setOver] = useState<string | "end" | null>(null);

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(TAB_DRAG_MIME) || e.dataTransfer.types.includes(NOTE_DRAG_MIME);

  function drop(e: DragEvent, beforeKey: string | null) {
    setOver(null);
    const tabKey = e.dataTransfer.getData(TAB_DRAG_MIME);
    if (tabKey) {
      e.preventDefault();
      onMove(tabKey, group, beforeKey);
      return;
    }
    const raw = e.dataTransfer.getData(NOTE_DRAG_MIME);
    if (raw) {
      e.preventDefault();
      try {
        onDropNote(JSON.parse(raw) as DroppedNote, group, beforeKey);
      } catch {
        /* malformed drag payload */
      }
    }
  }

  const other = group === 0 ? 1 : 0;

  return (
    <div
      role="tablist"
      aria-label={t("ws.tabs.label")}
      className={cn("flex h-9 shrink-0 items-stretch border-b border-line bg-grid-soft/60", !focused && groups > 1 && "opacity-90")}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          const isDirty = dirty.has(tab.key);
          const { Icon, color } = noteIcon({ category: tab.category, icon: tab.icon, color: tab.color });
          return (
            <ContextMenu key={tab.key}>
              <ContextMenuTrigger
                render={
                  <div
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(TAB_DRAG_MIME, tab.key);
                    }}
                    onDragOver={(e) => {
                      if (!accepts(e)) return;
                      e.preventDefault();
                      setOver(tab.key);
                    }}
                    onDragLeave={() => setOver((o) => (o === tab.key ? null : o))}
                    onDrop={(e) => drop(e, tab.key)}
                    onClick={() => onSelect(tab.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(tab.key);
                      }
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        onClose(tab.key);
                      }
                    }}
                    className={cn(
                      "group relative flex max-w-56 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-e border-line ps-3 pe-1.5 text-xs transition-colors select-none",
                      isActive
                        ? "bg-grid-bg text-grid-fg"
                        : "text-grid-muted hover:bg-grid-bg/60 hover:text-grid-fg",
                      over === tab.key && "shadow-[inset_2px_0_0_var(--grid-action)] rtl:shadow-[inset_-2px_0_0_var(--grid-action)]",
                    )}
                  />
                }
              >
                {isActive ? (
                  <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", focused ? "bg-grid-action" : "bg-grid-muted/50")} />
                ) : null}
                <Icon className="size-3.5 shrink-0" style={{ color: isActive ? color : undefined }} />
                <span className={cn("min-w-0 flex-1 truncate", !tab.id && "italic")} style={{ unicodeBidi: "plaintext" }}>
                  {tab.title || (tab.id ? t("notes.x.untitled") : t("editor.newNote"))}
                </span>
                <button
                  type="button"
                  aria-label={t("ws.tabs.close")}
                  title={t("ws.tabs.close")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.key);
                  }}
                  className="relative flex size-5 shrink-0 items-center justify-center rounded-sm text-grid-muted hover:bg-grid-line hover:text-grid-fg"
                >
                  {isDirty ? (
                    <>
                      <span aria-hidden className="size-2 rounded-full bg-grid-fg/70 group-hover:hidden" />
                      <X className="hidden size-3 group-hover:block" />
                    </>
                  ) : (
                    <X className={cn("size-3", !isActive && "opacity-0 group-hover:opacity-100")} />
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-48">
                <ContextMenuItem onClick={() => onClose(tab.key)}>{t("ws.tabs.close")}</ContextMenuItem>
                <ContextMenuItem disabled={tabs.length < 2} onClick={() => onCloseOthers(tab.key)}>
                  {t("ws.tabs.closeOthers")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => (groups > 1 ? onMove(tab.key, other, null) : onSplit(tab.key))}>
                  <Columns2 />
                  {t("ws.openToSide")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {/* The rest of the strip: drop here to append. */}
        <div
          className={cn("min-w-8 flex-1", over === "end" && "shadow-[inset_2px_0_0_var(--grid-action)] rtl:shadow-[inset_-2px_0_0_var(--grid-action)]")}
          onDragOver={(e) => {
            if (!accepts(e)) return;
            e.preventDefault();
            setOver("end");
          }}
          onDragLeave={() => setOver((o) => (o === "end" ? null : o))}
          onDrop={(e) => drop(e, null)}
        />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        {groups > 1 && group === 1 ? (
          <button
            type="button"
            aria-label={t("ws.unsplit")}
            title={t("ws.unsplit")}
            onClick={onUnsplit}
            className="flex size-6 items-center justify-center rounded-md text-grid-muted hover:bg-grid-bg hover:text-grid-fg"
          >
            <X className="size-3.5" />
          </button>
        ) : groups === 1 ? (
          <button
            type="button"
            aria-label={t("ws.split")}
            title={t("ws.split")}
            onClick={() => onSplit()}
            className="flex size-6 items-center justify-center rounded-md text-grid-muted hover:bg-grid-bg hover:text-grid-fg"
          >
            <Columns2 className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
