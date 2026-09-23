import { useState, type DragEvent } from "react";
import { Columns2, X } from "lucide-react";

import { noteIcon } from "@/lib/notes/note-icon";
import { cn } from "@/lib/utils";

import { IconButton } from "../../components/chrome";
import { SEP, showMenu } from "../../lib/native-menu";
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
  actionsRef,
  onOpenWindow,
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
  /** Host for the open editor's own controls (mode switch, note menu), so the
   *  pane has ONE header row: tabs at the start, editor controls at the end. */
  actionsRef?: (el: HTMLElement | null) => void;
  /** "Open in New Window" from the tab's menu. */
  onOpenWindow?: (key: string) => void;
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
      className={cn("app-chrome flex h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background ps-2 pe-2", !focused && groups > 1 && "[&_[aria-selected=true]]:bg-hover")}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
    >
      <div className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          const isDirty = dirty.has(tab.key);
          const { Icon } = noteIcon({ category: tab.category, icon: tab.icon, color: tab.color });
          return (
            <div
                    key={tab.key}
                    role="tab"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      void showMenu(
                        [
                          { id: "close", label: t("ws.tabs.close"), accelerator: "CmdOrCtrl+W" },
                          { id: "others", label: t("ws.tabs.closeOthers"), enabled: tabs.length > 1 },
                          SEP,
                          { id: "side", label: t("ws.openToSide") },
                          ...(tab.id ? [{ id: "window", label: t("sb.openWindow") }] : []),
                        ],
                        e,
                      ).then((id) => {
                        if (id === "close") onClose(tab.key);
                        else if (id === "others") onCloseOthers(tab.key);
                        else if (id === "side") (groups > 1 ? onMove(tab.key, other, null) : onSplit(tab.key));
                        else if (id === "window") onOpenWindow?.(tab.key);
                      });
                    }}
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
                      "group relative flex h-7 max-w-52 min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-md ps-2.5 pe-1 text-[13px] transition-colors select-none",
                      isActive
                        ? "bg-selected font-medium text-foreground"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground",
                      over === tab.key && "shadow-[inset_2px_0_0_var(--ring)] rtl:shadow-[inset_-2px_0_0_var(--ring)]",
                    )}
              >
                <Icon className="size-3.5 shrink-0 stroke-[1.75] opacity-70" />
                <span className={cn("min-w-0 flex-1 truncate", !tab.id && "italic")} dir="auto" style={{ unicodeBidi: "plaintext" }}>
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
                  className="relative flex size-[18px] shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
                >
                  {isDirty ? (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full bg-foreground/70 group-hover:hidden" />
                      <X className="hidden size-3 group-hover:block" />
                    </>
                  ) : (
                    <X className={cn("size-3", !isActive && "opacity-0 group-hover:opacity-100")} />
                  )}
                </button>
              </div>
          );
        })}
        {/* The rest of the strip: drop here to append. */}
        <div
          className={cn("h-full min-w-8 flex-1", over === "end" && "shadow-[inset_2px_0_0_var(--ring)] rtl:shadow-[inset_-2px_0_0_var(--ring)]")}
          onDragOver={(e) => {
            if (!accepts(e)) return;
            e.preventDefault();
            setOver("end");
          }}
          onDragLeave={() => setOver((o) => (o === "end" ? null : o))}
          onDrop={(e) => drop(e, null)}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <div ref={actionsRef} className="flex items-center gap-1" />
        {groups > 1 && group === 1 ? (
          <IconButton label={t("ws.unsplit")} onClick={onUnsplit}>
            <X />
          </IconButton>
        ) : groups === 1 ? (
          <IconButton label={t("ws.split")} onClick={() => onSplit()}>
            <Columns2 />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
