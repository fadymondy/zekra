import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { Markdown } from "../../components/markdown";
import type { Note } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../shell/toast";
import { useAuthedImagesIn } from "../editor/authed-dom-images";
import { notesApi, type NoteVersion } from "./notes-api";

/*
A note's version history (GET /api/notes/{id}/versions, newest first): the
list on the start side, the picked version rendered on the end side, and
"Restore this version" (confirmed), which POSTs /restore — the server writes
the old version back as a NEW version, so the current text stays in history.
Same flow as mobile's version sheet (note-sheets.tsx).
*/
export function VersionHistoryDialog({ note, token, canWrite, onOpenChange, onRestored }: {
  note: Note | null;
  token: string;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (note: Note) => void;
}) {
  const { t, locale } = useI18n();
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVersions(null);
    setError(null);
    setPicked(null);
    if (!note) return;
    let alive = true;
    notesApi
      .versions(token, note.id)
      .then((res) => {
        if (!alive) return;
        const list = res.versions ?? [];
        setVersions(list);
        setPicked(list[0]?.version ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [note, token]);

  const current = versions?.find((v) => v.version === picked) ?? null;
  useAuthedImagesIn(previewRef, current?.version);

  async function restore() {
    if (!note || !current) return;
    setConfirming(false);
    setBusy(true);
    try {
      const restored = await notesApi.restore(token, note.id, current.version);
      toast.success(t("notes.x.restored", { n: current.version }));
      onRestored(restored);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("notes.x.failed"));
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale === "ar" ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <>
      <Dialog open={!!note} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[80vh] flex-col gap-0 p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-border/60 px-5 py-4">
            <DialogTitle>{t("notes.x.versions")}</DialogTitle>
            <DialogDescription className="truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
              {note?.title || t("notes.x.untitled")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1">
            <ol className="w-64 shrink-0 overflow-y-auto border-e border-border/60">
              {error ? (
                <li className="p-4 text-sm text-destructive">{error}</li>
              ) : !versions ? (
                <li className="p-4 text-sm text-muted-foreground">{t("ws.versions.loading")}</li>
              ) : versions.length === 0 ? (
                <li className="p-4 text-sm text-muted-foreground">{t("notes.x.versionsEmpty")}</li>
              ) : (
                versions.map((v, i) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() => setPicked(v.version)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-4 py-2.5 text-start transition-colors",
                        picked === v.version ? "bg-muted" : "hover:bg-hover",
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span dir="ltr" className="font-mono text-xs text-foreground">
                          {t("notes.x.version", { n: v.version })}
                        </span>
                        {i === 0 ? (
                          <span className="rounded-sm bg-grid-action/15 px-1.5 text-[12px] text-grid-action">{t("notes.x.current")}</span>
                        ) : null}
                        {v.deleted ? (
                          <span className="rounded-sm bg-grid-danger/15 px-1.5 text-[12px] text-destructive">{t("notes.x.deletedTag")}</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{fmt(v.createdAt)}</span>
                      {v.authorAgent || v.source ? (
                        <span className="truncate text-[12.5px] text-muted-foreground">
                          {t("ws.versions.by", { who: v.authorAgent || v.source })}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ol>
            <div className="flex min-w-0 flex-1 flex-col">
              <div ref={previewRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {!current ? (
                  <p className="text-sm text-muted-foreground">{t("ws.versions.pick")}</p>
                ) : (
                  <>
                    <h2 className={current.description ? "mb-1 text-lg font-medium" : "mb-3 text-lg font-medium"} dir="auto" style={{ unicodeBidi: "plaintext" }}>
                      {current.title || t("notes.x.untitled")}
                    </h2>
                    {current.description ? (
                      <p className="mb-3 text-sm text-muted-foreground" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                        {current.description}
                      </p>
                    ) : null}
                    {current.body.trim() ? (
                      <Markdown text={current.body} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("notes.x.emptyVersion")}</p>
                    )}
                  </>
                )}
              </div>
              {canWrite && current && versions && current.version !== versions[0]?.version ? (
                <div className="flex justify-end border-t border-border/60 px-5 py-3">
                  <Button onClick={() => setConfirming(true)} disabled={busy}>
                    <RotateCcw />
                    {t("notes.x.restore")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        title={t("notes.x.restoreTitle", { n: current?.version ?? 0 })}
        body={t("notes.x.restoreBody")}
        confirmLabel={t("notes.x.restore")}
        onConfirm={() => void restore()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
