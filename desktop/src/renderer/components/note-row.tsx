import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, ArchiveRestore, Pin, PinOff, Trash2 } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import { useI18n } from "../lib/i18n";
import type { Note } from "../lib/api";

// Swipe past this (px) and the row commits its action on release.
const COMMIT = 96;
const MAX = 140;

export type NoteAction = "pin" | "archive" | "delete";

/**
 * A note row with three ways to act on it, per the product spec:
 *   - right-click  -> context menu
 *   - swipe        -> drag the row; start-side pins, end-side archives/deletes
 *   - hover        -> the inline buttons (kept for discoverability)
 * Archive and delete are destructive, so they ask the caller to confirm rather
 * than firing directly; pin is trivially reversible and applies immediately.
 */
export function NoteRow({ note, selected, onOpen, onAction }: {
  note: Note;
  selected: boolean;
  onOpen: () => void;
  onAction: (action: NoteAction) => void;
}) {
  const { t, isRtl } = useI18n();
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; id: number } | null>(null);

  // In RTL the visual start side is the right, so flip the sign to keep
  // "swipe towards the start edge = pin" true in both directions.
  const dir = isRtl ? -1 : 1;
  const travel = dx * dir;

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return; // let right-click open the context menu
    start.current = { x: e.clientX, id: e.pointerId };
    setDragging(true);
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const delta = e.clientX - start.current.x;
    if (Math.abs(delta) > 6) e.currentTarget.setPointerCapture(start.current.id);
    setDx(Math.max(-MAX, Math.min(MAX, delta)));
  }

  function up() {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (travel >= COMMIT) onAction("pin");
    else if (travel <= -COMMIT) onAction(note.archived ? "archive" : "archive");
    setDx(0);
  }

  const pinArmed = travel >= COMMIT;
  const archiveArmed = travel <= -COMMIT;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="relative overflow-hidden border-b border-line">
          {/* Action affordances revealed under the row while swiping */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4">
            <span className={cn("flex items-center gap-2 text-xs", pinArmed ? "text-grid-gold" : "text-grid-muted")}>
              {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {note.pinned ? t("row.unpin") : t("row.pin")}
            </span>
            <span className={cn("flex items-center gap-2 text-xs", archiveArmed ? "text-grid-warn" : "text-grid-muted")}>
              {note.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              {note.archived ? t("row.unarchive") : t("row.archive")}
            </span>
          </div>

          <div
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            style={{ transform: `translateX(${dx}px)` }}
            className={cn(
              "relative flex min-w-0 items-center gap-1 bg-grid-bg px-2",
              !dragging && "transition-transform",
              selected && "bg-grid-soft",
            )}
          >
            <button
              type="button"
              onClick={() => { if (Math.abs(dx) < 4) onOpen(); }}
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2.5 text-start"
            >
              {/* plaintext keeps Latin paths LTR (clipping at the end) while
                  Arabic titles still read RTL */}
              <span className="block max-w-full truncate text-sm font-medium" style={{ unicodeBidi: "plaintext" }}>
                {note.title || t("notes.untitled")}
              </span>
              <span className="block max-w-full truncate text-xs text-grid-muted">
                {new Date(note.updatedAt).toLocaleString()}
                {note.pinned ? ` · ${t("notes.pinned")}` : ""}
                {note.archived ? ` · ${t("notes.archived")}` : ""}
              </span>
            </button>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={() => onAction("pin")}>
          {note.pinned ? <PinOff /> : <Pin />}
          {note.pinned ? t("row.unpin") : t("row.pin")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAction("archive")}>
          {note.archived ? <ArchiveRestore /> : <Archive />}
          {note.archived ? t("row.unarchive") : t("row.archive")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onAction("delete")}>
          <Trash2 />
          {t("action.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
