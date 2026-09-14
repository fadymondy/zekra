import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Eye, EyeOff, ShieldAlert, Search } from "lucide-react";
import {
  Button, Input, Label, NativeSelect, Textarea,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@togo-framework/ui";
import { brainApi, type SecretMeta } from "../lib/brain";
import { PageHeading, Panel, Loading, Empty, Notice, CopyButton, ConfirmDelete } from "../components/page";

// The kinds the backend recognises (auto-capture + manual). `generic` is the default.
const KINDS = [
  "generic", "api_key", "password", "token", "env",
  "private_key", "connection_string", "credential",
] as const;

/** One secret row. The value is NEVER preloaded — it's fetched lazily via a
 * reveal mutation only when the user clicks Reveal. `permission_denied` (reveal
 * needs write/admin) is surfaced inline instead of crashing the row. */
function SecretRow({ s }: { s: SecretMeta }) {
  const qc = useQueryClient();

  const reveal = useMutation({
    mutationFn: () => brainApi.revealSecret({ namespace: s.namespace, name: s.name }),
  });
  const del = useMutation({
    mutationFn: () => brainApi.deleteSecret({ namespace: s.namespace, name: s.name }),
    onSuccess: (res) => {
      if (res.error) return;
      qc.invalidateQueries({ queryKey: ["brain", "secrets"] });
    },
  });

  const shown = reveal.data && !reveal.data.error ? reveal.data.value : undefined;
  const revealErr = reveal.data?.error;

  return (
    <div className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span dir="ltr" className="truncate font-mono text-[13px] font-medium text-foreground">{s.name}</span>
          <span className="grid-chip num">{s.kind || "generic"}</span>
        </div>
        {shown === undefined ? (
          <code dir="ltr" className="border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {s.hint || "•••"}
          </code>
        ) : (
          <code dir="ltr" className="min-w-0 max-w-md flex-1 break-all border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground">
            {shown}
          </code>
        )}

        <span className="num ms-auto flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          {s.sourceRef && <span dir="ltr">src {s.sourceRef}</span>}
          {s.createdBy && <span dir="ltr">by {s.createdBy}</span>}
          <span>upd {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}</span>
        </span>

        <div className="flex items-center gap-1.5">
          {shown !== undefined ? (
            <>
              <CopyButton value={shown} />
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => reveal.reset()}>
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => reveal.mutate()} disabled={reveal.isPending}>
              <Eye className="h-3.5 w-3.5" /> {reveal.isPending ? "Revealing…" : "Reveal"}
            </Button>
          )}
          <ConfirmDelete title="Delete secret" pending={del.isPending} onConfirm={() => del.mutate()} />
        </div>
      </div>

      {revealErr && (
        <Notice tone="warn" icon={<ShieldAlert className="h-3.5 w-3.5" />}>{revealErr.code}: {revealErr.message}</Notice>
      )}
      {del.data?.error && <Notice tone="danger">{del.data.error.code}: {del.data.error.message}</Notice>}
    </div>
  );
}

/** Add-secret dialog — name + value + kind, POSTed to putSecret (write/admin). */
function AddSecretModal({ namespace, onClose }: { namespace: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<string>("generic");

  const put = useMutation({
    mutationFn: () => brainApi.putSecret({ namespace, name: name.trim(), value, kind }),
    onSuccess: (res) => {
      if (res.error) return;
      qc.invalidateQueries({ queryKey: ["brain", "secrets"] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-active" /> Add secret</DialogTitle>
          <DialogDescription>
            Stored encrypted in <code dir="ltr" className="font-mono text-foreground">{namespace}</code>.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (name.trim() && value) put.mutate(); }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="secret-name">Name</Label>
            <Input id="secret-name" dir="ltr" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="OPENAI_API_KEY" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-value">Value</Label>
            <Textarea
              id="secret-value"
              dir="ltr"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder="sk-…"
              className="resize-y font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-kind">Kind</Label>
            <NativeSelect id="secret-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </NativeSelect>
          </div>
          {put.data?.error && <Notice tone="danger">{put.data.error.code}: {put.data.error.message}</Notice>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || !value || put.isPending}>
              {put.isPending ? "Saving…" : "Save secret"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Secrets vault — per-brain, namespace-scoped. Values are encrypted at rest and
 * are only ever fetched on an explicit Reveal (which needs write access). When
 * `namespace` is supplied (brain workspace) it locks to that brain and hides the
 * brain selector; standalone it auto-selects the richest brain. */
export function BrainSecrets({ namespace }: { namespace?: string } = {}) {
  const scoped = !!namespace;
  const namespaces = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces, enabled: !scoped });
  const brains = namespaces.data?.brains ?? [];

  // Auto-select the richest brain (most memories) once namespaces load.
  const richest = useMemo(
    () => [...brains].sort((a, b) => b.memories - a.memories)[0]?.namespace ?? "",
    [brains],
  );
  const [nsState, setNsState] = useState("");
  useEffect(() => { if (!scoped && !nsState && richest) setNsState(richest); }, [richest, nsState, scoped]);
  const ns = scoped ? namespace! : nsState;

  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");

  const secrets = useQuery({
    queryKey: ["brain", "secrets", ns],
    queryFn: () => brainApi.secrets(ns),
    enabled: !!ns,
  });
  const list = secrets.data?.secrets ?? [];
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? list.filter((s) => s.name.toLowerCase().includes(f) || (s.kind ?? "").toLowerCase().includes(f)) : list;
  }, [list, filter]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Vault"
        title="Secrets"
        description="Encrypted at rest and auto-captured from retained content. Revealing a value requires write access."
        actions={
          <>
            {!scoped && (
              <NativeSelect
                aria-label="Brain"
                value={ns}
                onChange={(e) => setNsState(e.target.value)}
                className="h-9 w-auto min-w-[12rem]"
              >
                {brains.length === 0 && <option value="">No brains</option>}
                {brains.map((b) => (
                  <option key={b.namespace} value={b.namespace}>
                    {b.namespace} ({b.memories.toLocaleString()})
                  </option>
                ))}
              </NativeSelect>
            )}
            <Button onClick={() => setAdding(true)} disabled={!ns}>
              <Plus className="h-4 w-4" /> Add secret
            </Button>
          </>
        }
      />

      <Panel
        label="Vault"
        meta={list.length > 0 ? (filter ? `${visible.length} of ${list.length}` : `${list.length} secrets`) : undefined}
      >
        {list.length > 5 && (
          <div className="border-b border-border px-4 py-2.5">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Filter secrets"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name or kind…"
                className="h-8 ps-8 text-xs"
              />
            </div>
          </div>
        )}
        {!ns ? (
          <Empty title="Select a brain">Pick a brain to view its vault.</Empty>
        ) : secrets.isLoading ? (
          <Loading label="Loading secrets…" />
        ) : secrets.data?.secrets === undefined ? (
          <div className="p-4"><Notice tone="danger">Couldn't load secrets.</Notice></div>
        ) : list.length === 0 ? (
          <Empty title="No secrets yet">
            Add one, or they appear in <span dir="ltr" className="font-mono">{ns}</span> as retained content is redacted.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty title="No matching secrets" />
        ) : (
          <div className="divide-y divide-border">
            {visible.map((s) => <SecretRow key={s.name} s={s} />)}
          </div>
        )}
      </Panel>

      {adding && ns && <AddSecretModal namespace={ns} onClose={() => setAdding(false)} />}
    </div>
  );
}
