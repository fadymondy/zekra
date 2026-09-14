import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { brainApi, type Grant, type Token } from "../lib/brain";
import { PageHeading, Panel, Loading, Empty, Monogram } from "../components/page";
import { GrantHeader, GrantRow } from "../components/grants";

/** Per-agent read/write row for THIS brain. Toggling read/write upserts the grant
 * via /grant; the revoke button removes this agent's access to this brain. */
function AgentGrantRow({ agentId, isAdmin, namespace, grant }: {
  agentId: string; isAdmin: boolean; namespace: string; grant?: Grant;
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["brain", "tokens"] });
  const upsert = useMutation({
    mutationFn: (v: { canRead: boolean; canWrite: boolean }) => brainApi.grant({ agentId, namespace, ...v }),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: () => brainApi.revokeGrant({ agentId, namespace }),
    onSuccess: invalidate,
  });

  return (
    <GrantRow
      label={agentId}
      name={
        <span className="flex min-w-0 items-center gap-2">
          <Monogram id={agentId} />
          <span dir="ltr" className="truncate font-mono text-[13px] font-medium text-foreground">{agentId}</span>
        </span>
      }
      extra={isAdmin && (
        <span className="flex items-center gap-2">
          <span className="micro text-active">admin</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">full access via admin token</span>
        </span>
      )}
      canRead={grant?.canRead ?? false}
      canWrite={grant?.canWrite ?? false}
      disabled={upsert.isPending}
      onChange={(v) => upsert.mutate(v)}
      onRevoke={grant ? () => revoke.mutate() : undefined}
      revoking={revoke.isPending}
    />
  );
}

/** Per-brain permissions — who can read/write THIS brain. Reuses the token +
 * grant API filtered to a single namespace. Token creation itself lives under
 * Admin (cross-brain). */
export function BrainWorkspacePermissions({ namespace }: { namespace: string }) {
  const tokens = useQuery({ queryKey: ["brain", "tokens"], queryFn: brainApi.tokens, refetchInterval: 20_000 });
  const list = (tokens.data?.tokens ?? []).filter((t: Token) => !t.revoked);

  const rows = useMemo(() => {
    // Dedupe by agentId; carry this brain's grant + admin flag.
    const m = new Map<string, { agentId: string; isAdmin: boolean; grant?: Grant }>();
    for (const t of list) {
      if (!t.agentId) continue;
      const grant = (t.grants ?? []).find((g) => g.namespace === namespace);
      const cur = m.get(t.agentId);
      m.set(t.agentId, {
        agentId: t.agentId,
        isAdmin: (cur?.isAdmin ?? false) || t.isAdmin,
        grant: cur?.grant ?? grant,
      });
    }
    return [...m.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
  }, [list, namespace]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Access"
        title="Permissions"
        description={
          <>
            Who can read or write <span dir="ltr" className="font-medium text-foreground">{namespace}</span>. Toggle a grant
            per agent; admin tokens always have full access. Create tokens under{" "}
            <Link to="/admin/tokens" className="font-medium text-active underline-offset-2 hover:underline">Admin · Tokens</Link>.
          </>
        }
      />

      <Panel label="Agents" meta={rows.length > 0 ? rows.length : undefined}>
        {tokens.isLoading ? (
          <Loading label="Loading agents…" />
        ) : rows.length === 0 ? (
          <Empty title="No agents yet">Create a token under Admin · Tokens, then grant it access here.</Empty>
        ) : (
          <>
            <GrantHeader subject="Agent" />
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <AgentGrantRow key={r.agentId} agentId={r.agentId} isAdmin={r.isAdmin} namespace={namespace} grant={r.grant} />
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
