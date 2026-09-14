import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { brainApi } from "../lib/brain";
import { PageHeading, Panel, StatCells, Loading, Empty } from "../components/page";
import { ActivityRow } from "../components/activity-row";

/** This brain's memory activity log — every retain/recall against the namespace,
 * newest first. Reuses the dashboard's activity list, filtered to $namespace. */
export function BrainActivity({ namespace }: { namespace: string }) {
  const q = useQuery({ queryKey: ["brain", "activity"], queryFn: () => brainApi.activity(200), refetchInterval: 8_000 });
  const rows = useMemo(
    () => (q.data?.items ?? []).filter((i) => i.namespace === namespace),
    [q.data, namespace],
  );
  const counts = useMemo(() => ({
    recalls: rows.filter((r) => r.op === "recall").length,
    writes: rows.filter((r) => r.op === "retain" || r.op === "reconsolidate").length,
    errors: rows.filter((r) => r.outcome === "error").length,
  }), [rows]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Observe"
        title="Activity"
        description={<>Every operation against <span dir="ltr" className="font-medium text-foreground">{namespace}</span>, newest first.</>}
      />

      <StatCells
        className="grid-cols-2 sm:grid-cols-4"
        stats={[
          { label: "Operations", value: rows.length.toLocaleString() },
          { label: "Recalls", value: counts.recalls.toLocaleString() },
          { label: "Writes", value: counts.writes.toLocaleString() },
          { label: "Errors", value: counts.errors.toLocaleString(), tone: counts.errors ? "danger" : "muted" },
        ]}
      />

      <Panel label="Memory activity" meta={rows.length > 0 ? `${rows.length} ops · live` : undefined}>
        {q.isLoading ? (
          <Loading label="Loading activity…" />
        ) : rows.length === 0 ? (
          <Empty title="No activity yet">Every retain and recall against this brain shows up here.</Empty>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((a) => <ActivityRow key={a.id} a={a} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}
