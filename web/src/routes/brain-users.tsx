import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { brainApi } from "../lib/brain";
import { PageHeading, Panel, Loading, Empty, Monogram } from "../components/page";
import { ActivityRow } from "../components/activity-row";

/** An agent in the list; the selected one takes the active rule on its inline-start edge. */
function AgentButton({
  label,
  count,
  selected,
  isAdmin = false,
  onClick,
  id,
}: {
  label: string;
  count: number;
  selected: boolean;
  isAdmin?: boolean;
  onClick: () => void;
  id?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full items-center gap-2.5 border-s-2 px-4 py-2.5 text-start text-sm transition-colors hover:bg-muted ${
        selected ? "border-s-active bg-muted" : "border-s-transparent"
      }`}
    >
      {id !== undefined && <Monogram id={id} />}
      <span dir={id !== undefined ? "ltr" : undefined} className="min-w-0 flex-1 truncate font-medium text-foreground">{label}</span>
      {isAdmin && <span className="micro text-active">admin</span>}
      <span className="num text-[11px] text-muted-foreground">{count}</span>
    </button>
  );
}

export function BrainUsers() {
  const [selected, setSelected] = useState<string>(""); // "" = all agents

  // Identities come from tokens (declared agents) unioned with agents seen in the
  // activity stream (agents that have actually done something).
  const tokens = useQuery({ queryKey: ["brain", "tokens"], queryFn: brainApi.tokens });
  const activity = useQuery({ queryKey: ["brain", "activity"], queryFn: () => brainApi.activity(200), refetchInterval: 8_000 });

  const items = activity.data?.items ?? [];
  const tokenList = tokens.data?.tokens ?? [];

  const agents = useMemo(() => {
    const map = new Map<string, { agentId: string; isAdmin: boolean; actions: number; lastAt: string }>();
    for (const t of tokenList) {
      if (!t.agentId) continue;
      map.set(t.agentId, { agentId: t.agentId, isAdmin: t.isAdmin, actions: 0, lastAt: "" });
    }
    for (const i of items) {
      const id = i.agentId || "(anonymous)";
      const cur = map.get(id) ?? { agentId: id, isAdmin: false, actions: 0, lastAt: "" };
      cur.actions += 1;
      if (!cur.lastAt || (i.ts && i.ts > cur.lastAt)) cur.lastAt = i.ts;
      map.set(id, cur);
    }
    return [...map.values()].sort((a, b) => b.actions - a.actions || a.agentId.localeCompare(b.agentId));
  }, [tokenList, items]);

  const rows = useMemo(() => {
    if (!selected) return items;
    if (selected === "(anonymous)") return items.filter((i) => !i.agentId);
    return items.filter((i) => i.agentId === selected);
  }, [items, selected]);

  const loading = tokens.isLoading || activity.isLoading;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Admin"
        title="Users & activity"
        description="Identities are agent ids. Pick an agent to see its recent actions."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel label="Agents" meta={agents.length}>
          <div className="divide-y divide-border">
            <AgentButton label="All agents" count={items.length} selected={selected === ""} onClick={() => setSelected("")} />
            {agents.map((a) => (
              <AgentButton
                key={a.agentId}
                id={a.agentId}
                label={a.agentId}
                count={a.actions}
                isAdmin={a.isAdmin}
                selected={selected === a.agentId}
                onClick={() => setSelected(a.agentId)}
              />
            ))}
          </div>
          {agents.length === 0 && (loading ? <Loading label="Loading agents…" /> : <Empty title="No agents yet" />)}
        </Panel>

        <Panel label={selected ? <>Actions · <span dir="ltr">{selected}</span></> : "Recent actions"} meta={rows.length}>
          {activity.isLoading ? (
            <Loading label="Loading activity…" />
          ) : rows.length === 0 ? (
            <Empty title="No activity for this agent yet" />
          ) : (
            <div className="divide-y divide-border">
              {rows.map((a) => <ActivityRow key={a.id} a={a} showNamespace showAgent={!selected} />)}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
