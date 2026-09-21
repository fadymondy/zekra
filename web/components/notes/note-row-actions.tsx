"use client"

import { useState } from "react"
import { ArchiveIcon, ArchiveRestoreIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useTranslations } from "@/lib/i18n"
import { useSwipe } from "./use-swipe"

/*
Row interactions for the web notes list, matching what desktop and mobile
already have (MH-149): pin, archive, delete — reachable by context menu
everywhere and by swipe on touch.

Archive and delete confirm first; pin applies immediately because it is
trivially reversible. The confirmations live here so every entry point goes
through the same prompt, exactly as the mobile implementation does.
*/

export type NoteRowAction = "pin" | "archive" | "delete"

export function NoteRowActions({
  pinned,
  archived,
  title,
  onAction,
  children,
}: {
  pinned: boolean
  archived: boolean
  title: string
  onAction: (action: NoteRowAction) => void
  children: React.ReactNode
}) {
  const { t, isRtl } = useTranslations()
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null)

  const swipe = useSwipe({
    rtl: isRtl,
    // Start edge pins (reversible, fires immediately); end edge archives,
    // which confirms — the same split the mobile row uses.
    onStart: () => onAction("pin"),
    onEnd: () => setConfirm("archive"),
  })

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          {...swipe.handlers}
          style={{
            transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined,
            // No transition while dragging, or the row lags the finger.
            transition: swipe.swiping ? "none" : "transform 150ms ease-out",
            // Let the browser own vertical scrolling; we only take horizontal.
            touchAction: "pan-y",
          }}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          <ContextMenuItem onClick={() => onAction("pin")}>
            {pinned ? <PinOffIcon /> : <PinIcon />}
            {pinned ? t("notes.unpin") : t("notes.pin")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setConfirm("archive")}>
            {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            {archived ? t("notes.unarchive") : t("notes.archive")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
            <Trash2Icon />
            {t("notes.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? t("notes.deleteTitle") : archived ? t("notes.unarchiveTitle") : t("notes.archiveTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete" ? t("notes.deleteBody") : t("notes.archiveBody")}
              {title ? <span className="mt-1 block font-medium text-grid-fg">{title}</span> : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              // The destructive styling is reserved for delete; archiving is
              // reversible and should not read as equally final.
              className={confirm === "delete" ? "bg-grid-danger text-white hover:bg-grid-danger/90" : undefined}
              onClick={() => {
                const action = confirm
                setConfirm(null)
                if (action) onAction(action)
              }}
            >
              {confirm === "delete" ? t("common.delete") : archived ? t("notes.unarchive") : t("notes.archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
