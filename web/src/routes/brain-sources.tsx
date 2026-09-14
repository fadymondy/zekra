import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plug, Plus, RefreshCw, Check, Webhook, FileText,
  Globe, Github, Database, Link2, AlertTriangle, CircleDot,
} from "lucide-react";
import {
  Button, Input, Label, Textarea,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@togo-framework/ui";
import { brainApi, type Datasource } from "../lib/brain";
import {
  PageHeading, Panel, Loading, Empty, Notice, ToneTag, toneFor, CodeValue, CopyButton, ConfirmDelete, RecallSquares,
} from "../components/page";

// The connector kinds the picker offers. `fields` drive the per-kind form; a
// value maps 1:1 into the created source's `config`. `soon` kinds are shown as
// disabled tiles (backend connectors not built yet).
type Field = { key: string; label: string; placeholder: string; textarea?: boolean; optional?: boolean };
type KindSpec = {
  kind: string; label: string; icon: any; blurb: string;
  fields: Field[]; soon?: boolean;
};

const KINDS: KindSpec[] = [
  {
    kind: "webhook", label: "Webhook", icon: Webhook,
    blurb: "Push documents in from anywhere — we mint a URL + secret to POST to.",
    fields: [],
  },
  {
    kind: "text", label: "Text / Markdown", icon: FileText,
    blurb: "Paste text or markdown to ingest directly as memories.",
    fields: [{ key: "content", label: "Content", placeholder: "# Notes\nPaste markdown or plain text…", textarea: true }],
  },
  {
    kind: "crawler", label: "Website", icon: Globe,
    blurb: "Crawl a URL and ingest its pages.",
    fields: [
      { key: "url", label: "Start URL", placeholder: "https://docs.example.com" },
      { key: "maxPages", label: "Max pages", placeholder: "50", optional: true },
    ],
  },
  {
    kind: "github", label: "GitHub", icon: Github,
    blurb: "Ingest files from a repository path.",
    fields: [
      { key: "repo", label: "Repo", placeholder: "owner/name" },
      { key: "branch", label: "Branch", placeholder: "main", optional: true },
      { key: "path", label: "Path", placeholder: "docs/", optional: true },
    ],
  },
  {
    kind: "sql", label: "SQL", icon: Database,
    blurb: "Run a query against a database and ingest the rows.",
    fields: [
      { key: "dsn", label: "Connection string (DSN)", placeholder: "postgres://user:pass@host/db" },
      { key: "query", label: "Query", placeholder: "SELECT id, body FROM articles", textarea: true },
    ],
  },
  // Coming soon — disabled in the picker.
  { kind: "pdf", label: "PDF", icon: FileText, blurb: "Ingest PDF documents.", fields: [], soon: true },
  { kind: "image", label: "Image", icon: CircleDot, blurb: "Ingest images with captions.", fields: [], soon: true },
  { kind: "mcp", label: "MCP server", icon: Plug, blurb: "Pull context from an MCP server.", fields: [], soon: true },
];

const KIND_BY: Record<string, KindSpec> = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

function iconFor(kind: string) { return KIND_BY[kind]?.icon ?? Plug; }

function KindChip({ kind }: { kind: string }) {
  const Icon = iconFor(kind);
  return (
    <span className="grid-chip">
      <Icon className="h-3 w-3 text-active" /> {KIND_BY[kind]?.label ?? kind}
    </span>
  );
}

/** A webhook source's push endpoint — the URL + secret to hand out. */
function PushEndpoint({ id, secret }: { id: string; secret: string }) {
  const url = brainApi.ingestUrl(id);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="micro text-muted-foreground">Push URL</div>
        <div className="flex items-center gap-2">
          <CodeValue className="flex-1">{url}</CodeValue>
          <CopyButton value={url} label="URL" />
        </div>
      </div>
      {secret && (
        <div className="space-y-1.5">
          <div className="micro text-muted-foreground">Header · X-Webhook-Secret</div>
          <div className="flex items-center gap-2">
            <CodeValue className="flex-1">{secret}</CodeValue>
            <CopyButton value={secret} label="Secret" />
          </div>
        </div>
      )}
    </div>
  );
}

/** One configured source. Shows kind, status, doc-count, last-sync and the
 * sync/delete actions. Webhook sources reveal their push URL + secret inline. */
function SourceRow({ s }: { s: Datasource }) {
  const qc = useQueryClient();
  const [showHook, setShowHook] = useState(false);

  const sync = useMutation({
    mutationFn: () => brainApi.syncDatasource({ id: s.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "datasources"] }),
  });
  const del = useMutation({
    mutationFn: () => brainApi.deleteDatasource({ id: s.id }),
    onSuccess: (res) => {
      if (res.error) return;
      qc.invalidateQueries({ queryKey: ["brain", "datasources"] });
    },
  });

  const isWebhook = s.kind === "webhook";
  const secret = typeof s.config?.secret === "string" ? (s.config.secret as string) : "";
  const syncing = sync.isPending || s.status === "syncing";
  const Icon = iconFor(s.kind);

  return (
    <div className="space-y-2.5 px-4 py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-background text-active">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{s.name}</span>
            <KindChip kind={s.kind} />
          </div>
          <div className="num mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <ToneTag tone={toneFor(s.status)}>{s.status || "idle"}</ToneTag>
            <span>{s.docCount.toLocaleString()} docs</span>
            <span>synced {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : "never"}</span>
            {isWebhook && (
              <button
                type="button"
                onClick={() => setShowHook((v) => !v)}
                aria-expanded={showHook}
                className="inline-flex items-center gap-1 text-active underline-offset-2 hover:underline"
              >
                <Link2 className="h-3 w-3" /> {showHook ? "hide push URL" : "push URL"}
              </button>
            )}
          </div>
        </div>

        <div className="ms-auto flex items-center gap-1.5">
          {!isWebhook && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => sync.mutate()} disabled={syncing}>
              {syncing ? <RecallSquares /> : <RefreshCw className="h-3.5 w-3.5" />} {syncing ? "Syncing…" : "Sync"}
            </Button>
          )}
          <ConfirmDelete title="Delete source" pending={del.isPending} onConfirm={() => del.mutate()} />
        </div>
      </div>

      {/* Sync result / errors as styled caveats, not raw errors. */}
      {sync.data && !sync.data.error && (
        <Notice tone="ok" icon={<Check className="h-3.5 w-3.5" />}>
          Ingested {sync.data.ingested.toLocaleString()} docs · {sync.data.status}
        </Notice>
      )}
      {(sync.data?.error || s.lastError) && (
        <Notice tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>{sync.data?.error ?? s.lastError}</Notice>
      )}
      {del.data?.error && <Notice tone="danger">{del.data.error.code}: {del.data.error.message}</Notice>}

      {isWebhook && showHook && (
        <div className="border border-border bg-background p-3">
          <PushEndpoint id={s.id} secret={secret} />
        </div>
      )}
    </div>
  );
}

/** Add-source dialog — a kind picker whose form fields change per kind. On a
 * webhook create, the push URL + secret are shown to copy before closing. */
function AddSourceModal({ namespace, onClose }: { namespace: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<string>("webhook");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Datasource | null>(null);

  const spec = KIND_BY[kind];

  const create = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const v = values[f.key];
        if (v !== undefined && v !== "") config[f.key] = v;
      }
      return brainApi.createDatasource({ namespace, kind, name: name.trim(), config });
    },
    onSuccess: (res) => {
      if (res.error) return;
      qc.invalidateQueries({ queryKey: ["brain", "datasources"] });
      if (res.kind === "webhook") setCreated(res); // reveal the push URL + secret
      else onClose();
    },
  });

  const requiredMissing = spec.fields.some((f) => !f.optional && !values[f.key]?.trim());
  const secret = created && typeof created.config?.secret === "string" ? (created.config.secret as string) : "";
  const canSubmit = !!name.trim() && !requiredMissing && !create.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          // Post-create: show the webhook push endpoint to copy.
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Check className="h-4 w-4 text-tone-ok" /> Webhook source ready</DialogTitle>
              <DialogDescription>Push documents to this URL with the secret header.</DialogDescription>
            </DialogHeader>
            <PushEndpoint id={created.id} secret={secret} />
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-active" /> Add a source</DialogTitle>
              <DialogDescription>
                Connect knowledge into <code dir="ltr" className="font-mono text-foreground">{namespace}</code>.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}
            >
              {/* Kind picker — hairline tiles; the chosen one carries the memory square. */}
              <div role="radiogroup" aria-label="Source kind" className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
                {KINDS.map((k) => {
                  const Icon = k.icon;
                  const active = k.kind === kind;
                  return (
                    <button
                      key={k.kind}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={k.soon}
                      onClick={() => { setKind(k.kind); setValues({}); }}
                      title={k.soon ? "Coming soon" : k.blurb}
                      className={`relative flex flex-col items-center gap-1.5 px-2 py-3 text-xs transition-colors ${
                        k.soon
                          ? "cursor-not-allowed bg-card text-muted-foreground/50"
                          : active
                            ? "bg-muted text-foreground"
                            : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${active ? "text-active" : ""}`} />
                      <span className="max-w-full truncate">{k.label}</span>
                      {active && <span aria-hidden className="absolute end-1.5 top-1.5 size-1.5 bg-active" />}
                      {k.soon && <span className="absolute end-1.5 top-1 font-mono text-[9px] uppercase">soon</span>}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">{spec.blurb}</p>

              <div className="space-y-1.5">
                <Label htmlFor="src-name">Name</Label>
                <Input id="src-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${spec.label} source`} />
              </div>
              {spec.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`src-${f.key}`}>
                    {f.label}{f.optional && <span className="ms-1 font-normal text-muted-foreground">(optional)</span>}
                  </Label>
                  {f.textarea ? (
                    <Textarea
                      id={`src-${f.key}`}
                      dir="ltr"
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      rows={4}
                      placeholder={f.placeholder}
                      className="resize-y font-mono text-xs"
                    />
                  ) : (
                    <Input
                      id={`src-${f.key}`}
                      dir="ltr"
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  )}
                </div>
              ))}
              {kind === "webhook" && (
                <Notice tone="info">A push URL and secret are generated on create — you'll copy them next.</Notice>
              )}
              {create.data?.error && <Notice tone="danger">{create.data.error.code}: {create.data.error.message}</Notice>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={!canSubmit}>
                  {create.isPending ? "Connecting…" : "Add source"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Sources — the data-source connectors for a brain. Lists configured sources
 * and offers an Add-source flow with a per-kind form. Scoped to the workspace's
 * brain via the `namespace` prop. */
export function BrainSources({ namespace }: { namespace: string }) {
  const [adding, setAdding] = useState(false);
  const sources = useQuery({
    queryKey: ["brain", "datasources", namespace],
    queryFn: () => brainApi.datasources(namespace),
    enabled: !!namespace,
    refetchInterval: 10_000,
  });
  const list = sources.data?.datasources ?? [];
  const docs = list.reduce((n, s) => n + (s.docCount ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Ingest"
        title="Sources"
        description={
          <>
            Connect knowledge into <span dir="ltr" className="font-medium text-foreground">{namespace}</span> — GitHub, a website,
            a SQL database or a webhook. Each source ingests documents as memories.
          </>
        }
        actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add source</Button>}
      />

      <Panel
        label="Connected sources"
        meta={list.length > 0 ? `${list.length} sources · ${docs.toLocaleString()} docs` : undefined}
      >
        {sources.isLoading ? (
          <Loading label="Loading sources…" />
        ) : list.length === 0 ? (
          <Empty
            title="No sources connected yet"
            action={<Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add your first source</Button>}
          >
            Sources connect knowledge into this brain — GitHub, a website, a SQL database or a webhook. Add one to start ingesting.
          </Empty>
        ) : (
          <div className="divide-y divide-border">
            {list.map((s) => <SourceRow key={s.id} s={s} />)}
          </div>
        )}
      </Panel>

      {adding && <AddSourceModal namespace={namespace} onClose={() => setAdding(false)} />}
    </div>
  );
}
