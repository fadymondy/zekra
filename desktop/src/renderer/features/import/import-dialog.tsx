import { AlertTriangle, CheckCircle2, FileArchive, FolderOpen, Loader2, NotebookText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { ImportScanResult, ImportSource } from "../../../shared/ipc";
import type { Brain } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useRouter } from "../../shell/router";
import { useSession } from "../../shell/session";
import { runImport, type ImportTally } from "./run-import";

/*
File ▸ Import from ▸ Apple Notes / Google Keep / Notion / Markdown Folder…
(MH-450, Mark It Down's importer chooser, rebuilt on the Zekra API).

  pick      what the source is, which brain it goes into, "Choose…" (or
            "Read Apple Notes"): main opens the native picker and parses
  scanning  progress streamed from main; Cancel aborts the scan
  preview   how many notes, what is skipped and why, a sample of titles
  running   notes created one by one (run-import.ts); Stop finishes the
            current note and stops
  done      imported / skipped / failed, the failures listed, "Open brain"
*/

type Phase =
  | { name: "pick" }
  | { name: "scanning"; done: number; total?: number; message?: string }
  | { name: "preview"; scan: ImportScanResult }
  | { name: "running"; scan: ImportScanResult; done: number; current?: string }
  | { name: "done"; tally: ImportTally }
  | { name: "error"; message: string };

const SOURCE_ICON: Record<ImportSource, typeof FolderOpen> = {
  "apple-notes": NotebookText,
  "google-keep": FileArchive,
  notion: FileArchive,
  "markdown-folder": FolderOpen,
};

const REASONS = ["locked", "trashed", "deleted", "empty", "too-large", "unreadable"] as const;
type Reason = (typeof REASONS)[number];

function newId(): string {
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function writableBrains(brains: Brain[] | null): Brain[] {
  return (brains ?? []).filter((b) => b.canWrite);
}

export function brainLabel(b: Brain): string {
  return b.displayName?.trim() || b.namespace;
}

export function ImportDialog({ source, onClose }: { source: ImportSource | null; onClose: () => void }) {
  const { t } = useI18n();
  const { brains, settings, token, reloadBrains } = useSession();
  const { navigate } = useRouter();
  const writable = useMemo(() => writableBrains(brains), [brains]);
  const [ns, setNs] = useState<string>("");
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const jobId = useRef<string>("");
  const stopRef = useRef(false);
  const open = source !== null;
  const busy = phase.name === "scanning" || phase.name === "running";
  const desktop = Boolean(bridge().importScan);

  // Fresh state per opening; default brain = the active one if writable.
  useEffect(() => {
    if (!open) return;
    setPhase({ name: "pick" });
    const active = writable.find((b) => b.namespace === settings.activeBrain);
    setNs((active ?? writable[0])?.namespace ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source]);

  useEffect(() => {
    const off = bridge().onImportProgress?.((e) => {
      if (e.id !== jobId.current) return;
      setPhase((p) => (p.name === "scanning" ? { name: "scanning", done: e.done, total: e.total, message: e.message } : p));
    });
    return () => off?.();
  }, []);

  if (!source) return null;
  const srcName = t(`imp.source.${source}`);
  const Icon = SOURCE_ICON[source];

  async function scan() {
    if (!source || !bridge().importScan) return;
    const id = newId();
    jobId.current = id;
    setPhase({ name: "scanning", done: 0 });
    try {
      const res = await bridge().importScan!({ id, source });
      if (jobId.current !== id) return; // cancelled and restarted
      if (res.status === "canceled") setPhase({ name: "pick" });
      else if (res.status === "error") setPhase({ name: "error", message: errorText(res) });
      else setPhase({ name: "preview", scan: res });
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  function errorText(res: ImportScanResult): string {
    switch (res.errorCode) {
      case "permission":
        return t("imp.error.permission");
      case "unsupported":
        return t("imp.error.unsupported");
      case "empty":
        return t("imp.error.empty");
      case "timeout":
        return t("imp.error.timeout");
      case "not-found":
        return `${t("imp.error.not-found", { source: srcName })}${res.error ? `\n${res.error}` : ""}`;
      default:
        return res.error || t("imp.error.title");
    }
  }

  async function start(scan: ImportScanResult) {
    if (!token || !ns || !source) return;
    stopRef.current = false;
    setPhase({ name: "running", scan, done: 0 });
    try {
      const tally = await runImport({
        id: scan.id,
        token,
        namespace: ns,
        source,
        total: scan.total,
        shouldStop: () => stopRef.current,
        onProgress: (p) => setPhase((cur) => (cur.name === "running" ? { ...cur, done: p.done, current: p.current ?? cur.current } : cur)),
      });
      tally.skipped += Object.values(scan.skipped).reduce((a, b) => a + b, 0);
      setPhase({ name: "done", tally });
      void reloadBrains();
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 401 ? t("auth.failed") : e instanceof Error ? e.message : String(e);
      setPhase({ name: "error", message });
    }
  }

  function cancelScan() {
    const id = jobId.current;
    jobId.current = "";
    void bridge().importCancel?.(id);
    setPhase({ name: "pick" });
  }

  function close() {
    if (phase.name === "scanning") cancelScan();
    if (phase.name === "preview") void bridge().importCancel?.(phase.scan.id);
    if (phase.name === "running") return; // Stop first
    onClose();
  }

  const skippedList = (scan: ImportScanResult) =>
    Object.entries(scan.skipped)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) =>
        t((REASONS as readonly string[]).includes(reason) ? `imp.reason.${reason as Reason}` : "imp.reason.failed", { count: n }),
      )
      .join(", ");

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-grid-action" />
            {t("imp.title", { source: srcName })}
          </DialogTitle>
          <DialogDescription>{t(`imp.desc.${source}`)}</DialogDescription>
        </DialogHeader>

        {!desktop ? (
          <p className="text-sm text-muted-foreground">{t("imp.desktopOnly")}</p>
        ) : phase.name === "pick" || phase.name === "preview" ? (
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              {t("imp.brain")}
              {writable.length ? (
                <Select
                  items={writable.map((b) => ({ value: b.namespace, label: brainLabel(b) }))}
                  value={ns}
                  onValueChange={(v) => setNs(String(v ?? ""))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {writable.map((b) => (
                      <SelectItem key={b.namespace} value={b.namespace}>
                        {brainLabel(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm text-destructive">{t("imp.noWritable")}</span>
              )}
            </label>
            {phase.name === "preview" ? <Preview scan={phase.scan} source={source} skipped={skippedList(phase.scan)} /> : null}
          </div>
        ) : phase.name === "scanning" ? (
          <div className="grid gap-2 py-2">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin text-grid-action" />
              {phase.total ? t("imp.readingCount", { done: phase.done, total: phase.total }) : t("imp.reading")}
            </div>
            {phase.total ? <Progress value={Math.round((phase.done / Math.max(1, phase.total)) * 100)} /> : null}
            {phase.message ? (
              <p dir="auto" className="truncate text-xs text-muted-foreground">
                {phase.message}
              </p>
            ) : null}
          </div>
        ) : phase.name === "running" ? (
          <div className="grid gap-2 py-2">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin text-grid-action" />
              {t("imp.importing", { done: phase.done, total: phase.scan.total })}
            </div>
            <Progress value={Math.round((phase.done / Math.max(1, phase.scan.total)) * 100)} />
            {phase.current ? (
              <p dir="auto" className="truncate text-xs text-muted-foreground">
                {t("imp.current", { title: phase.current })}
              </p>
            ) : null}
          </div>
        ) : phase.name === "done" ? (
          <Summary tally={phase.tally} />
        ) : (
          <div className="flex gap-2 rounded-md border border-border/60 bg-muted p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: "var(--grid-warn)" }} />
            <p className="whitespace-pre-line text-foreground">{phase.message}</p>
          </div>
        )}

        <DialogFooter>
          {phase.name === "pick" ? (
            <>
              <Button variant="ghost" onClick={close}>
                {t("imp.cancel")}
              </Button>
              <Button onClick={() => void scan()} disabled={!desktop || !ns}>
                {source === "apple-notes" ? t("imp.readNotes") : source === "markdown-folder" ? t("imp.chooseFolder") : t("imp.choose")}
              </Button>
            </>
          ) : phase.name === "scanning" ? (
            <Button variant="ghost" onClick={cancelScan}>
              {t("imp.cancel")}
            </Button>
          ) : phase.name === "preview" ? (
            <>
              <Button variant="ghost" onClick={close}>
                {t("imp.cancel")}
              </Button>
              <Button onClick={() => void start(phase.scan)} disabled={!ns || !token}>
                {t("imp.start", { count: phase.scan.total })}
              </Button>
            </>
          ) : phase.name === "running" ? (
            <Button variant="outline" onClick={() => (stopRef.current = true)}>
              {t("imp.stop")}
            </Button>
          ) : phase.name === "done" ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("imp.close")}
              </Button>
              {phase.tally.imported > 0 && ns ? (
                <Button
                  onClick={() => {
                    navigate({ name: "brain", ns, tab: "notes", noteId: phase.tally.firstNoteId });
                    onClose();
                  }}
                >
                  {t("imp.openBrain")}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("imp.close")}
              </Button>
              <Button onClick={() => setPhase({ name: "pick" })}>{t("imp.retry")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Preview({ scan, source, skipped }: { scan: ImportScanResult; source: ImportSource; skipped: string }) {
  const { t } = useI18n();
  const more = scan.total - scan.sample.length;
  return (
    <div className="grid gap-2 rounded-md border border-border/60 bg-pane-raised p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <CheckCircle2 className="size-4" style={{ color: "var(--grid-ok)" }} />
        <span dir="auto">{t("imp.found", { count: scan.total, label: scan.sourceLabel ?? "" })}</span>
      </p>
      {scan.images ? <p className="text-xs text-muted-foreground">{t("imp.images", { count: scan.images })}</p> : null}
      {skipped ? <p className="text-xs text-muted-foreground">{t("imp.skipped", { list: skipped })}</p> : null}
      {scan.warnings.length ? <p className="text-xs text-muted-foreground">{t("imp.warnings", { count: scan.warnings.length })}</p> : null}
      {scan.sample.length ? (
        <div className="text-xs text-muted-foreground">
          {t("imp.sample")}
          <ul className="mt-1 list-disc ps-5 text-foreground">
            {scan.sample.map((s, i) => (
              <li key={i} dir="auto" className="truncate">
                {s}
              </li>
            ))}
          </ul>
          {more > 0 ? <p className="mt-1">{t("imp.more", { count: more })}</p> : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("imp.tagHint", { tag: source })}</p>
    </div>
  );
}

function Summary({ tally }: { tally: ImportTally }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 text-sm">
      <p className="flex items-center gap-2 font-medium text-foreground">
        {tally.failed.length ? (
          <AlertTriangle className="size-4" style={{ color: "var(--grid-warn)" }} />
        ) : (
          <CheckCircle2 className="size-4" style={{ color: "var(--grid-ok)" }} />
        )}
        {tally.stopped ? t("imp.done.stopped") : t("imp.done.title")}
      </p>
      <p className="text-muted-foreground">
        {t("imp.done.summary", { imported: tally.imported, skipped: tally.skipped, failed: tally.failed.length })}
      </p>
      {tally.failed.length ? (
        <div className="max-h-40 overflow-y-auto rounded-md border border-border/60 bg-pane-raised p-2 text-xs">
          <p className="mb-1 font-medium text-foreground">{t("imp.failedList")}</p>
          <ul className="grid gap-1">
            {tally.failed.slice(0, 100).map((f, i) => (
              <li key={i} dir="auto">
                <span className="text-foreground">{f.title}</span>
                <span className="text-muted-foreground"> — {f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
