import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { Button } from "@togo-framework/ui";
import { brainApi } from "../lib/brain";
import { LaunchSessionModal } from "../components/launch-session-modal";
import { Page, PageHeading, Panel, Loading, Empty, Segmented } from "../components/page";
import { ActivityRow } from "../components/activity-row";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "searches", label: "Searches" },
  { value: "writes", label: "Writes" },
  { value: "errors", label: "Errors" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** Operation feed. When `namespace` is supplied (brain workspace) it filters to
 * that brain and surfaces a "Launch session bound to this brain" action. */
export function BrainSessions({ namespace }: { namespace?: string } = {}) {
  const scoped = !!namespace;
  const [filter, setFilter] = useState<Filter>("all");
  const [launching, setLaunching] = useState(false);
  const q = useQuery({ queryKey: ["brain", "activity", "full"], queryFn: () => brainApi.activity(200), refetchInterval: 6_000 });
  const items = q.data?.items ?? [];
  const rows = useMemo(() => {
    const base = scoped ? items.filter((i) => i.namespace === namespace) : items;
    switch (filter) {
      case "searches": return base.filter((i) => i.op === "recall");
      case "writes": return base.filter((i) => i.op === "retain" || i.op === "reconsolidate");
      case "errors": return base.filter((i) => i.outcome === "error");
      default: return base;
    }
  }, [items, filter, scoped, namespace]);

  return (
    <Page>
      <PageHeading
        eyebrow="Agents"
        title="Sessions"
        description={
          scoped
            ? <>Operations against <span dir="ltr" className="font-medium text-foreground">{namespace}</span> — and launch a Claude Code session bound to it.</>
            : "A live, evidence-oriented feed of every operation against memory."
        }
        actions={scoped && (
          <Button onClick={() => setLaunching(true)}>
            <Rocket className="h-4 w-4" /> Launch session
          </Button>
        )}
      />
      {launching && namespace && <LaunchSessionModal namespace={namespace} onClose={() => setLaunching(false)} />}

      <Panel
        label="Operation feed"
        meta={rows.length > 0 ? `${rows.length} ops · live` : undefined}
      >
        <div className="border-b border-line px-6 py-3">
          <Segmented label="Filter operations" options={FILTERS} value={filter} onChange={setFilter} />
        </div>
        {q.isLoading ? (
          <Loading label="Loading operations…" />
        ) : rows.length === 0 ? (
          <Empty title={filter === "all" ? "No activity yet" : `No ${filter} yet`}>
            Every recall and retain appears here as agents use the brain.
          </Empty>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((a) => <ActivityRow key={a.id} a={a} showNamespace={!scoped} />)}
          </div>
        )}
      </Panel>
    </Page>
  );
}
