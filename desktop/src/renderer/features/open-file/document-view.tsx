import { BrainCircuit, Code2, Download, Eye, FileText, FolderSearch, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { ExportFormat, OpenFileEvent } from "../../../shared/ipc";
import { zekraApi } from "../../lib/api";
import { showMenu } from "../../lib/native-menu";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useCommand } from "../../shell/commands";
import { useRouter } from "../../shell/router";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { exportNote, EXPORT_FORMATS } from "../editor/export";
import { brainLabel, writableBrains } from "../import/import-dialog";
import { ExtendedMarkdown } from "../markdown-extras/extended-markdown";
import { documentToNote, wordCount } from "./document";

/*
A Markdown file opened from Finder / the Dock / File ▸ Open Markdown… (⌘O) /
argv (MH-450, Mark It Down's core job). Main has already read the file; this
is a full-window reading surface over the app (it is a LOCAL document, not a
note in any brain), with:

  Preview / Source   the web renderer + Mark It Down's extras (math, mermaid,
                     alerts, footnotes, frontmatter panel) / the raw text
  Export             md (the file as is), html, pdf, docx, png, txt — the same
                     exporters as notes (features/editor/export.ts); also
                     File ▸ Export while the document is showing
  Import into brain  creates a note (title from frontmatter / first heading /
                     file name) in a writable brain, then offers to open it
  Show in Finder     window.zekra.revealInFinder

Several files can be open; they show as tabs. Closing the last one returns to
the app underneath.
*/

export function DocumentView({
  docs,
  activePath,
  onSelect,
  onClose,
}: {
  docs: OpenFileEvent[];
  activePath: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const { t } = useI18n();
  const { user } = useSession();
  const doc = docs.find((d) => d.path === activePath) ?? docs[docs.length - 1];
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [importing, setImporting] = useState(false);
  const note = useMemo(() => documentToNote(doc?.content ?? "", doc?.name ?? ""), [doc]);
  const words = useMemo(() => wordCount(note.body), [note]);

  useEffect(() => setMode("preview"), [activePath]);

  async function doExport(format: ExportFormat) {
    if (!doc) return;
    try {
      const res =
        format === "md"
          ? await bridge().saveFile({
              suggestedName: doc.name,
              filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
              text: doc.content,
            })
          : await exportNote({ title: note.title, body: note.body }, format);
      if (!res.canceled) toast.success(t("doc.exported"), { description: res.path });
    } catch (e) {
      toast.error(t("doc.exportFailed"), { description: e instanceof Error ? e.message : String(e) });
    }
  }

  // File ▸ Export acts on the document while it is showing.
  const showing = Boolean(doc);
  useCommand("export:md", () => void doExport("md"), showing);
  useCommand("export:html", () => void doExport("html"), showing);
  useCommand("export:pdf", () => void doExport("pdf"), showing);
  useCommand("export:docx", () => void doExport("docx"), showing);
  useCommand("export:png", () => void doExport("png"), showing);
  useCommand("export:txt", () => void doExport("txt"), showing);
  useCommand("close-tab", () => (doc ? onClose(doc.path) : false), showing);

  if (!doc) return null;

  return (
    <div
      role="dialog"
      aria-label={doc.name}
      className="fixed inset-x-0 bottom-0 top-11 z-40 flex flex-col border-t border-border/60 bg-background"
    >
      {docs.length > 1 ? (
        <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-2">
          {docs.map((d) => (
            <div
              key={d.path}
              className={`flex h-6 items-center gap-1 rounded-sm ps-2 pe-1 text-xs ${
                d.path === doc.path ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <button type="button" className="max-w-48 truncate" onClick={() => onSelect(d.path)} title={d.path}>
                {d.name}
              </button>
              <button type="button" aria-label={t("doc.close")} onClick={() => onClose(d.path)} className="rounded-sm p-0.5 hover:bg-hover">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <FileText className="size-4 shrink-0 text-grid-action" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground" dir="auto">
            {doc.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground" dir="ltr" title={doc.path}>
            {t("doc.local")} · {doc.path}
          </div>
        </div>
        <div className="ms-auto flex items-center gap-1">
          <div className="me-1 flex rounded-md border border-border/60 p-0.5" role="group">
            <Button size="xs" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => setMode("preview")} aria-pressed={mode === "preview"}>
              <Eye />
              {t("doc.preview")}
            </Button>
            <Button size="xs" variant={mode === "source" ? "secondary" : "ghost"} onClick={() => setMode("source")} aria-pressed={mode === "source"}>
              <Code2 />
              {t("doc.source")}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) =>
              void showMenu(EXPORT_FORMATS.map((f) => ({ id: f, label: `.${f}` })), e.currentTarget).then((id) => id && void doExport(id as (typeof EXPORT_FORMATS)[number]))
            }
          >
            <Download />
            {t("doc.export")}
          </Button>
          {bridge().revealInFinder ? (
            <Button size="sm" variant="ghost" onClick={() => void bridge().revealInFinder?.(doc.path)}>
              <FolderSearch />
              {t("doc.reveal")}
            </Button>
          ) : null}
          {user ? (
            <Button size="sm" onClick={() => setImporting(true)}>
              <BrainCircuit />
              {t("doc.import")}
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" aria-label={t("doc.close")} title={t("doc.close")} onClick={() => onClose(doc.path)}>
            <X />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {mode === "preview" ? (
            <ExtendedMarkdown key={doc.path} text={doc.content} />
          ) : (
            <pre dir="auto" className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {doc.content}
            </pre>
          )}
        </div>
      </div>

      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border/60 px-3 text-[11px] text-muted-foreground">
        <span>{t("doc.words", { count: words })}</span>
        <span className="ms-auto">Markdown</span>
      </footer>

      <ImportDocumentDialog
        open={importing}
        onClose={() => setImporting(false)}
        name={doc.name}
        note={note}
        onImported={() => onClose(doc.path)}
      />
    </div>
  );
}

function ImportDocumentDialog({
  open,
  onClose,
  name,
  note,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  note: { title: string; body: string; tags: string[] };
  onImported: () => void;
}) {
  const { t } = useI18n();
  const { brains, settings, token, reloadBrains } = useSession();
  const { navigate } = useRouter();
  const writable = useMemo(() => writableBrains(brains), [brains]);
  const [ns, setNs] = useState("");
  const [title, setTitle] = useState(note.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(note.title);
    const active = writable.find((b) => b.namespace === settings.activeBrain);
    setNs((active ?? writable[0])?.namespace ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!token || !ns) return;
    setBusy(true);
    try {
      const created = await zekraApi.createNote(token, ns, {
        title: title.trim() || note.title,
        body: note.body,
        tags: note.tags,
      });
      const brain = writable.find((b) => b.namespace === ns);
      onClose();
      toast.success(t("doc.imported", { brain: brain ? brainLabel(brain) : ns }), {
        action: {
          label: t("doc.openNote"),
          onClick: () => {
            onImported();
            navigate({ name: "brain", ns, tab: "notes", noteId: created.id });
          },
        },
      });
      void reloadBrains();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle dir="auto">{t("doc.importTitle", { name })}</DialogTitle>
          <DialogDescription dir="auto">{t("doc.importBody", { title: title.trim() || note.title })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            {t("editor.title")}
            <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            {t("imp.brain")}
            {writable.length ? (
              <Select items={writable.map((b) => ({ value: b.namespace, label: brainLabel(b) }))} value={ns} onValueChange={(v) => setNs(String(v ?? ""))}>
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("imp.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !ns || !token}>
            {busy ? t("doc.importing") : t("doc.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
