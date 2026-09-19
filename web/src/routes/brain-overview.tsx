import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Network, ArrowRight, MessagesSquare } from "lucide-react";
import { Button } from "@togo-framework/ui";
import { brainApi, type ActivityItem } from "../lib/brain";
import { BrainGraphView } from "../components/brain-graph-view";
import { MemorySquare } from "../components/brand";
import { Hatch, Page, Panel, StatCells, PageHeading } from "../components/page";

/** Brain Overview — the flagship. "Everything wired over the brain": the graph explorer for
 * THIS brain is the centrepiece, framed by the brain's live stat cells, the invitation to ask
 * it, and a compact recent-activity list. */
export function BrainOverview({ namespace }: { namespace: string }) {
  const nav = useNavigate();
  const detail = useQuery({
    queryKey: ["brain", "detail", namespace],
    queryFn: () => brainApi.brainDetail(namespace),
    refetchInterval: 15_000,
  });
  const graph = useQuery({
    queryKey: ["brain", "graph", namespace],
    queryFn: () => brainApi.graph(namespace, 3000),
  });
  const secrets = useQuery({
    queryKey: ["brain", "secrets", namespace],
    queryFn: () => brainApi.secrets(namespace),
  });
  const activity = useQuery({
    queryKey: ["brain", "activity"],
    queryFn: () => brainApi.activity(200),
    refetchInterval: 8_000,
  });

  const d = detail.data && !detail.data.error ? detail.data : undefined;
  const nodes = graph.data?.nodes ?? [];
  const edges = graph.data?.edges ?? [];
  const secretCount = secrets.data?.secrets?.length ?? 0;
  const recent = useMemo(
    () => (activity.data?.items ?? []).filter((i) => i.namespace === namespace).slice(0, 8),
    [activity.data, namespace],
  );
  // Suggested questions from the brain's top named entities, so the workspace opens with
  // somewhere to go.
  const suggestions = useMemo(() => {
    const named = nodes.filter((n) => !["root", "type"].includes(n.group ?? "")).map((n) => n.name).filter(Boolean);
    return Array.from(new Set(named)).slice(0, 4);
  }, [nodes]);

  const num = (n: number, isLoading: boolean) => (isLoading ? "—" : n.toLocaleString());
  const gaps = d?.openGaps ?? 0;

  return (
    <Page>
      <PageHeading
        eyebrow="Overview"
        title={<span dir="ltr">{namespace}</span>}
        actions={<span className="grid-chip num">{d ? `${d.memories.toLocaleString()} memories` : "brain"}</span>}
      />
      <StatCells
        className="grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
        stats={[
          { label: "Memories", value: num(d?.memories ?? 0, detail.isLoading) },
          { label: "Graph nodes", value: num(nodes.length, graph.isLoading) },
          { label: "Graph edges", value: num(edges.length, graph.isLoading) },
          { label: "Recalls", value: num(d?.recalls ?? 0, detail.isLoading) },
          { label: "Open gaps", value: num(gaps, detail.isLoading), tone: gaps ? "warn" : "muted", to: "/b/$namespace/gaps", params: { namespace } },
          { label: "Secrets", value: num(secretCount, secrets.isLoading), to: "/b/$namespace/secrets", params: { namespace } },
        ]}
      />

      {/* Ask the brain — the brand's recall panel as an invitation, seeded with the brain's own
          top entities as suggested questions. */}
      <section className="-my-px flex flex-col gap-4 border-y border-line bg-grid-card px-6 py-6 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <MemorySquare />
            <span className="text-[15px] font-medium text-grid-fg">
              Ask the <span dir="ltr" className="text-active">{namespace}</span> brain
            </span>
          </div>
          <p className="text-sm font-light text-grid-body">
            A live agent grounded only in this brain's memories — every answer cites its sources.
          </p>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => nav({ to: "/b/$namespace/chat", params: { namespace } })}
                  className="grid-chip transition-colors hover:border-active hover:text-foreground"
                >
                  Tell me about {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button asChild>
          <Link to="/b/$namespace/chat" params={{ namespace }}>
            <MessagesSquare className="h-4 w-4" /> Chat
          </Link>
        </Button>
      </section>

      <Hatch />

      {/* The graph — centrepiece */}
      <Panel
        label="Memory graph"
        meta={`${nodes.length} nodes · ${edges.length} edges${graph.data?.derived ? " · derived" : ""}`}
        className="h-[600px]"
        bodyClassName="flex flex-col"
      >
        {nodes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Network className="h-8 w-8 opacity-40" />
            <div className="text-sm">{graph.isLoading ? "Loading graph…" : "No graph yet — retain memories to grow entities."}</div>
          </div>
        ) : (
          <BrainGraphView key={namespace} data={{ ready: true, nodes, edges }} namespace={namespace} />
        )}
      </Panel>

      {/* Recent activity */}
      <Panel
        label="Recent activity"
        actions={
          <Link
            to="/b/$namespace/activity" params={{ namespace }}
            className="inline-flex items-center gap-1 text-xs text-foreground underline decoration-violet underline-offset-4"
          >
            View all <ArrowRight className="h-3 w-3 rtl:-scale-x-100" />
          </Link>
        }
      >
        {recent.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-grid-muted">
            {activity.isLoading ? "Loading…" : "No activity for this brain yet."}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((a: ActivityItem) => (
              <li key={a.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                <span className="num font-medium text-foreground">{a.op}</span>
                <span className="truncate text-xs text-muted-foreground">{a.agentId || "—"}</span>
                <span className="num ms-auto text-[11px] text-muted-foreground">{a.latencyMs ? `${a.latencyMs}ms` : ""}</span>
                <span className="num text-[11px] text-muted-foreground">{a.ts ? new Date(a.ts).toLocaleTimeString() : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
