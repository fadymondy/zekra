import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, RotateCcw } from "lucide-react";
import { Button, NativeSelect } from "@togo-framework/ui";
import { brainApi, type Gap, type GapStatus } from "../lib/brain";
import { PageHeading, Panel, Loading, Empty, Segmented, ToneSquare, type Tone } from "../components/page";

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "warn" },
  indexed: { label: "Indexed", tone: "ok" },
  dismissed: { label: "Dismissed", tone: "muted" },
};
const ORDER = ["open", "indexed", "dismissed"] as const;
const FILTERS = [
  { value: "", label: "All" },
  ...ORDER.map((s) => ({ value: s, label: STATUS_META[s].label })),
] as const;

function GapRow({ g, scoped, onResolve, busy }: { g: Gap; scoped: boolean; onResolve: (s: GapStatus) => void; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground" title={g.query}>{g.query}</div>
        <div className="num mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {!scoped && <span dir="ltr" className="grid-chip">{g.namespace}</span>}
          <span>{g.hits} {g.hits === 1 ? "miss" : "misses"}</span>
          <span>first {g.firstSeen ? new Date(g.firstSeen).toLocaleDateString() : "—"}</span>
          <span>last {g.lastSeen ? new Date(g.lastSeen).toLocaleString() : "—"}</span>
          {g.resolution && <span className="font-sans font-light italic">“{g.resolution}”</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {g.status !== "indexed" && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onResolve("indexed")} disabled={busy}>
            <Check className="h-3.5 w-3.5 text-tone-ok" /> Mark indexed
          </Button>
        )}
        {g.status !== "dismissed" && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => onResolve("dismissed")} disabled={busy}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        )}
        {g.status !== "open" && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onResolve("open")} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5 text-tone-warn" /> Reopen
          </Button>
        )}
      </div>
    </div>
  );
}

/** Knowledge gaps. When `namespace` is supplied (brain workspace) it locks to
 * that brain and hides the brain selector, keeping the status filter. */
export function BrainGaps({ namespace }: { namespace?: string } = {}) {
  const scoped = !!namespace;
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>(""); // "" = all
  const [nsState, setNsState] = useState<string>("");
  const nsFilter = scoped ? namespace! : nsState;

  const namespaces = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces, enabled: !scoped });
  // Fetch with server filters when set; the "" default returns open+indexed, so to
  // get dismissed too we ask per status when "all" is selected.
  const gaps = useQuery({
    queryKey: ["brain", "gaps", "all", statusFilter, nsFilter],
    queryFn: async () => {
      if (statusFilter) return brainApi.gaps({ status: statusFilter, namespace: nsFilter, limit: 200 });
      // "All statuses": union of the three explicit statuses.
      const [open, indexed, dismissed] = await Promise.all([
        brainApi.gaps({ status: "open", namespace: nsFilter, limit: 200 }),
        brainApi.gaps({ status: "indexed", namespace: nsFilter, limit: 200 }),
        brainApi.gaps({ status: "dismissed", namespace: nsFilter, limit: 200 }),
      ]);
      return { gaps: [...(open.gaps ?? []), ...(indexed.gaps ?? []), ...(dismissed.gaps ?? [])] };
    },
    refetchInterval: 15_000,
  });

  const resolve = useMutation({
    mutationFn: (v: { id: number; status: GapStatus }) => brainApi.resolveGap(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain", "gaps"] });
      qc.invalidateQueries({ queryKey: ["brain", "stats"] });
    },
  });

  const grouped = useMemo(() => {
    const all = gaps.data?.gaps ?? [];
    const m: Record<string, Gap[]> = { open: [], indexed: [], dismissed: [] };
    for (const g of all) (m[g.status] ?? (m[g.status] = [])).push(g);
    return m;
  }, [gaps.data]);

  const brains = namespaces.data?.brains ?? [];
  const visibleStatuses: readonly string[] = statusFilter ? [statusFilter] : ORDER;
  const total = (gaps.data?.gaps ?? []).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Recall quality"
        title="Knowledge gaps"
        description="Recall queries that came back thin or empty. Index the ones worth capturing; dismiss the noise."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Filter by status" options={FILTERS} value={statusFilter} onChange={setStatusFilter} />
        {!scoped && (
          <NativeSelect
            aria-label="Brain"
            value={nsFilter}
            onChange={(e) => setNsState(e.target.value)}
            className="h-8 w-auto min-w-[11rem] text-xs"
          >
            <option value="">All brains</option>
            {brains.map((b) => <option key={b.namespace} value={b.namespace}>{b.namespace}</option>)}
          </NativeSelect>
        )}
        {total > 0 && <span className="num ms-auto text-[11px] text-muted-foreground">{total} gaps</span>}
      </div>

      {gaps.isLoading ? (
        <Panel><Loading label="Loading gaps…" /></Panel>
      ) : total === 0 ? (
        <Panel><Empty title="No gaps here">Every recall is finding memories.</Empty></Panel>
      ) : (
        visibleStatuses.map((s) => {
          const rows = grouped[s] ?? [];
          if (rows.length === 0) return null;
          const meta = STATUS_META[s];
          return (
            <Panel
              key={s}
              label={<span className="inline-flex items-center gap-2"><ToneSquare tone={meta.tone} />{meta.label}</span>}
              meta={rows.length}
            >
              <div className="divide-y divide-border">
                {rows.map((g) => (
                  <GapRow
                    key={g.id}
                    g={g}
                    scoped={scoped}
                    busy={resolve.isPending && resolve.variables?.id === g.id}
                    onResolve={(status) => resolve.mutate({ id: g.id, status })}
                  />
                ))}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}
