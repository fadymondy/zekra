import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, ChevronRight, ChevronDown, X } from "lucide-react";
import { Button, Checkbox, Input, Label, NativeSelect } from "@togo-framework/ui";
import { brainApi, type Grant, type Token } from "../lib/brain";
import {
  Page, PageHeading, Panel, Loading, Empty, Notice, ToneTag, Monogram, CodeValue, CopyButton, ConfirmDelete,
} from "../components/page";
import { GrantHeader, GrantRow } from "../components/grants";

/** Per-brain grants editor for one agent. Toggling read/write upserts via /grant;
 * the revoke button removes the grant for that brain. */
function GrantsEditor({ agentId, grants }: { agentId: string; grants: Grant[] }) {
  const qc = useQueryClient();
  const namespaces = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces });
  const [addNs, setAddNs] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["brain", "tokens"] });
  const upsert = useMutation({
    mutationFn: (v: { namespace: string; canRead: boolean; canWrite: boolean }) =>
      brainApi.grant({ agentId, ...v }),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (namespace: string) => brainApi.revokeGrant({ agentId, namespace }),
    onSuccess: invalidate,
  });

  const brains = namespaces.data?.brains ?? [];
  const granted = new Set(grants.map((g) => g.namespace));
  const available = brains.filter((b) => !granted.has(b.namespace));

  return (
    <div className="border-t border-line bg-grid-soft">
      <GrantHeader subject="Brain" />
      {grants.length === 0 ? (
        <p className="px-6 py-3 text-xs text-grid-muted">
          No grants yet — this agent can only reach brains an admin token allows.
        </p>
      ) : (
        <div className="divide-y divide-line">
          {grants.map((g) => (
            <GrantRow
              key={g.namespace}
              label={g.namespace}
              name={<span dir="ltr" className="truncate font-mono text-[13px] text-foreground">{g.namespace}</span>}
              canRead={g.canRead}
              canWrite={g.canWrite}
              disabled={upsert.isPending}
              onChange={(v) => upsert.mutate({ namespace: g.namespace, ...v })}
              onRevoke={() => revoke.mutate(g.namespace)}
              revoking={revoke.isPending}
            />
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3">
          <NativeSelect
            aria-label="Brain to grant"
            value={addNs}
            onChange={(e) => setAddNs(e.target.value)}
            className="h-8 w-auto min-w-[12rem] text-xs"
          >
            <option value="">Add a brain…</option>
            {available.map((b) => <option key={b.namespace} value={b.namespace}>{b.namespace}</option>)}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => { if (addNs) { upsert.mutate({ namespace: addNs, canRead: true, canWrite: false }); setAddNs(""); } }}
            disabled={!addNs || upsert.isPending}
          >
            <Plus className="h-3.5 w-3.5" /> Grant read
          </Button>
        </div>
      )}
    </div>
  );
}

function TokenRow({ t }: { t: Token }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => brainApi.revokeToken({ token: t.token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain", "tokens"] }),
  });
  const n = t.grants?.length ?? 0;

  return (
    <div className={t.revoked ? "opacity-60" : ""}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-6 py-3 text-sm">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-expanded={open}
          aria-label={open ? "Hide grants" : "Show grants"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" />}
        </Button>
        <Monogram id={t.agentId} />
        <span dir="ltr" className="font-mono text-[13px] font-medium text-foreground">{t.agentId}</span>
        {t.label && <span className="min-w-0 truncate text-xs text-muted-foreground">{t.label}</span>}
        {t.isAdmin && <ToneTag tone="active">admin</ToneTag>}
        {t.revoked && <ToneTag tone="danger">revoked</ToneTag>}
        <span className="num ms-auto text-[11px] text-muted-foreground">
          {n} grant{n === 1 ? "" : "s"} · last used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
        </span>
        {!t.revoked && (
          <ConfirmDelete title={`Revoke ${t.agentId}'s token`} label="Revoke" pending={revoke.isPending} onConfirm={() => revoke.mutate()} />
        )}
      </div>
      {open && <GrantsEditor agentId={t.agentId} grants={t.grants ?? []} />}
    </div>
  );
}

function CreateTokenForm() {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [label, setLabel] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [created, setCreated] = useState<Token | null>(null);

  const create = useMutation({
    mutationFn: () => brainApi.createToken({ agentId: agentId.trim(), label: label.trim(), isAdmin }),
    onSuccess: (t) => {
      if (t.error) return;
      setCreated(t);
      setAgentId(""); setLabel(""); setIsAdmin(false);
      qc.invalidateQueries({ queryKey: ["brain", "tokens"] });
    },
  });

  return (
    <Panel label="Create token">
      <form
        className="space-y-3 px-6 py-4"
        onSubmit={(e) => { e.preventDefault(); if (agentId.trim()) create.mutate(); }}
      >
        <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="tok-agent">Agent id</Label>
            <Input id="tok-agent" dir="ltr" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="alice" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tok-label">Label</Label>
            <Input id="tok-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop MCP" />
          </div>
          <div className="flex h-9 items-center gap-2">
            <Checkbox id="tok-admin" checked={isAdmin} onCheckedChange={(v) => setIsAdmin(v === true)} />
            <Label htmlFor="tok-admin" className="font-normal">Admin</Label>
          </div>
          <Button type="submit" disabled={!agentId.trim() || create.isPending}>
            <Plus className="h-4 w-4" /> {create.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>
        {create.data?.error && (
          <Notice tone="danger">{create.data.error.code}: {create.data.error.message}</Notice>
        )}
        {created && (
          <Notice tone="ok" icon={<Check className="h-3.5 w-3.5" />}>
            <div className="font-medium text-foreground">
              Token for <span dir="ltr" className="font-mono">{created.agentId}</span> — shown once. Copy it now.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CodeValue wrap className="flex-1">{created.token}</CodeValue>
              <CopyButton value={created.token} />
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Dismiss" onClick={() => setCreated(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-2 text-muted-foreground">
              The holder sets <code className="font-mono">ZEKRA_TOKEN</code> in their MCP config to act as{" "}
              <strong dir="ltr" className="font-medium text-foreground">{created.agentId}</strong>.
            </p>
          </Notice>
        )}
      </form>
    </Panel>
  );
}

export function BrainPermissions() {
  const tokens = useQuery({ queryKey: ["brain", "tokens"], queryFn: brainApi.tokens, refetchInterval: 20_000 });
  const list = tokens.data?.tokens ?? [];
  const active = list.filter((t) => !t.revoked).length;

  return (
    <Page>
      <PageHeading
        eyebrow="Admin"
        title="Tokens & access"
        description={
          <>
            Access tokens and per-brain grants. A token's holder sets <code className="font-mono text-foreground">ZEKRA_TOKEN</code> in
            their MCP config to act as that agent.
          </>
        }
      />

      <CreateTokenForm />

      <Panel label="Tokens" meta={list.length > 0 ? `${active} active · ${list.length} total` : undefined}>
        {tokens.isLoading ? (
          <Loading label="Loading tokens…" />
        ) : list.length === 0 ? (
          <Empty title="No tokens yet">Create one above to let an agent reach a brain.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {list.map((t) => <TokenRow key={t.token} t={t} />)}
          </div>
        )}
      </Panel>
    </Page>
  );
}
