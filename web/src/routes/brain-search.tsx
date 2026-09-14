import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Search as SearchIcon, Pencil, Save, X, Check,
  MessagesSquare, Sparkles, Filter, Star, SlidersHorizontal,
} from "lucide-react";
import { Button, Input, Textarea } from "@togo-framework/ui";
import { brainApi, type Recalled } from "../lib/brain";
import { MemorySquare } from "../components/brand";

/** Which brain a result came from. One accent for every brain: identity is the name. */
function BrainChip({ ns }: { ns: string }) {
  return (
    <span className="grid-chip">
      <MemorySquare /> <span dir="ltr">{ns}</span>
    </span>
  );
}

/** The recall score as the brand draws it: a light-violet grade bar beside the mono figure. */
function Grade({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return (
    <span className="inline-flex items-center gap-2" title={`score ${score.toFixed(3)}`}>
      <span aria-hidden className="block h-1 w-12 bg-muted">
        <span className="block h-full bg-active" style={{ width: `${pct}%` }} />
      </span>
      <span className="num">{score.toFixed(3)}</span>
    </span>
  );
}

/** A single recall result with an inline edit affordance. Editing content saves via
 * POST /api/brain/memory/edit and updates the row on success. Namespace comes from the
 * result itself (cross-brain search). */
function ResultRow({ r, onSaved }: { r: Recalled; onSaved: (content: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(r.content);
  const ns = r.namespace ?? "";

  const save = useMutation({
    mutationFn: () => brainApi.editMemory({ namespace: ns, id: r.id, content: draft }),
    onSuccess: (res) => {
      if (res.error) return; // keep editor open; error shown inline
      onSaved(draft);
      setEditing(false);
    },
  });

  return (
    <div className="bg-card p-4 transition-colors hover:bg-muted/40">
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, Math.max(3, draft.split("\n").length))}
            autoFocus
          />
          {save.data?.error && (
            <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-tone-danger">
              {save.data.error.code}: {save.data.error.message}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDraft(r.content); setEditing(false); }}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || draft.trim() === "" || draft === r.content}>
              <Save className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <div className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{r.content}</div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Edit memory" onClick={() => { setDraft(r.content); setEditing(true); }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {ns && <BrainChip ns={ns} />}
            <span className="grid-chip num">{r.network}·{r.memoryType}</span>
            <span className="num truncate">{r.sourceKind}{r.sourceRef ? ` · ${r.sourceRef}` : ""}</span>
            {r.viaEntity && <span className="text-active">via {r.viaEntity}</span>}
            <span className="ms-auto flex items-center gap-3">
              <Grade score={r.score} />
              <span className="num">imp {r.importance.toFixed(2)}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** A toggleable facet — the grid chip with aria-pressed (CaBrain's active colour when on). */
function FacetChip({ label, active, onClick, icon }: { label: ReactNode; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="grid-chip transition-colors hover:text-foreground">
      {active && <Check className="h-3 w-3" />}
      {icon}
      {label}
    </button>
  );
}

// The three memory "networks" the console filters on.
const NETWORKS = ["fact", "experience", "belief"];

/** Search surface. When `namespace` is supplied (rendered inside a brain workspace) it locks to
 * that single brain and hides the cross-brain picker; otherwise it's the global cross-brain
 * search. A Chat/Recall/Search mode switch, visible facet chips (network · type · source ·
 * importance) over the result set, and a styled caveat when a query returns nothing. */
export function BrainSearch({ namespace }: { namespace?: string } = {}) {
  const scoped = !!namespace;
  const nav = useNavigate();
  const [q, setQ] = useState("");
  // Recall (graph-aware, single brain) vs Search (hybrid, cross-brain).
  const [mode, setMode] = useState<"recall" | "search">(scoped ? "recall" : "search");
  // Selected brains; empty set = ALL brains (the default). Ignored when scoped.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{ results?: Recalled[]; error?: string; ran?: boolean; q?: string }>({});

  // Active tuners (client-side facets over the returned results).
  const [fNet, setFNet] = useState<Set<string>>(new Set());
  const [fType, setFType] = useState<Set<string>>(new Set());
  const [fSrc, setFSrc] = useState<Set<string>>(new Set());
  const [highImp, setHighImp] = useState(false);

  const namespaces = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces, enabled: !scoped });
  const brains = namespaces.data?.brains ?? [];

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };
  const toggle = (ns: string) => toggleIn(selected, setSelected, ns);

  const search = useMutation({
    mutationFn: () => {
      const query = q.trim();
      if (scoped && mode === "recall") return brainApi.recall({ namespace: namespace!, query, limit: 20 });
      return brainApi.search({
        query,
        namespaces: scoped ? [namespace!] : selected.size ? [...selected] : undefined,
        limit: 20,
      });
    },
    onSuccess: (r) => {
      if (r.error) setState({ error: `${r.error.code}: ${r.error.message}`, ran: true, q: q.trim() });
      else setState({ results: r.results ?? [], ran: true, q: q.trim() });
    },
    onError: (e: any) => setState({ error: String(e?.message ?? e), ran: true, q: q.trim() }),
  });

  const clearTuners = () => { setFNet(new Set()); setFType(new Set()); setFSrc(new Set()); setHighImp(false); };
  const run = () => { if (q.trim()) { clearTuners(); search.mutate(); } };

  const patch = (id: string, content: string) =>
    setState((s) => ({ ...s, results: s.results?.map((x) => (x.id === id ? { ...x, content } : x)) }));

  const allActive = selected.size === 0;
  const raw = state.results ?? [];

  // Facet vocabularies derived from the current result set.
  const typeFacets = useMemo(() => Array.from(new Set(raw.map((r) => r.memoryType).filter(Boolean))).sort(), [raw]);
  const srcFacets = useMemo(() => Array.from(new Set(raw.map((r) => r.sourceKind).filter(Boolean))).sort(), [raw]);
  const netFacets = useMemo(() => NETWORKS.filter((n) => raw.some((r) => r.network === n)), [raw]);

  // Apply the active tuners.
  const results = useMemo(() => raw.filter((r) =>
    (fNet.size === 0 || fNet.has(r.network)) &&
    (fType.size === 0 || fType.has(r.memoryType)) &&
    (fSrc.size === 0 || fSrc.has(r.sourceKind)) &&
    (!highImp || (r.importance ?? 0) >= 0.7),
  ), [raw, fNet, fType, fSrc, highImp]);

  const hasFilters = fNet.size || fType.size || fSrc.size || highImp;
  const modes: { key: "chat" | "recall" | "search"; label: string; icon: typeof SearchIcon }[] = [
    ...(scoped ? [{ key: "chat" as const, label: "Chat", icon: MessagesSquare }] : []),
    ...(scoped ? [{ key: "recall" as const, label: "Recall", icon: Sparkles }] : []),
    { key: "search", label: "Search", icon: SearchIcon },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      {/* The search moment */}
      <section className="border border-border bg-card p-5 sm:p-6">
        {/* Mode switch */}
        <div className="inline-flex overflow-hidden border border-border bg-background">
          {modes.map((m, i) => {
            const on = m.key === mode;
            return (
              <button
                key={m.key}
                onClick={() => { if (m.key === "chat") nav({ to: "/b/$namespace/chat", params: { namespace: namespace! } }); else setMode(m.key); }}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${i ? "border-s border-border" : ""} ${
                  on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            );
          })}
        </div>

        <h1 className="mt-4 text-3xl font-medium tracking-tight text-foreground">
          {scoped ? (mode === "recall" ? "Recall from this brain" : "Search this brain") : "Search across every brain"}
        </h1>
        <p className="mb-5 mt-2 max-w-[64ch] text-sm font-light leading-relaxed text-card-foreground">
          {scoped
            ? (mode === "recall"
              ? <>Graph-aware recall scoped to <span dir="ltr" className="font-medium text-foreground">{namespace}</span> — walks entities to surface related memories.</>
              : <>Hybrid search — dense vector + BM25 (RRF) + rerank — scoped to <span dir="ltr" className="font-medium text-foreground">{namespace}</span>.</>)
            : "Hybrid recall — dense vector + BM25 (RRF) + rerank — over all brains at once, or scope to a few."}
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="what did we decide about…"
              autoFocus
              className="h-11 ps-10"
            />
          </div>
          <Button onClick={run} disabled={search.isPending || !q.trim()} className="h-11 px-5">
            <SearchIcon className="h-4 w-4" />{search.isPending ? "Searching…" : mode === "recall" && scoped ? "Recall" : "Search"}
          </Button>
        </div>

        {/* Brain multi-select — hidden when locked to a single brain workspace. */}
        {!scoped && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <FacetChip label="All brains" active={allActive} onClick={() => setSelected(new Set())} />
            {brains.map((b) => (
              <FacetChip
                key={b.namespace}
                active={selected.has(b.namespace)}
                onClick={() => toggle(b.namespace)}
                label={<><span dir="ltr">{b.namespace}</span><span className="num text-muted-foreground">{b.memories.toLocaleString()}</span></>}
              />
            ))}
          </div>
        )}
      </section>

      {state.error && (
        <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-tone-danger">{state.error}</div>
      )}

      {/* Tuners — visible filter chips over the results. */}
      {raw.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border border-border px-3 py-2.5">
          <span className="micro me-1 inline-flex items-center gap-1.5 text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" /> Tune</span>
          {netFacets.map((n) => <FacetChip key={n} label={n} active={fNet.has(n)} onClick={() => toggleIn(fNet, setFNet, n)} />)}
          {typeFacets.length > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-border" />}
          {typeFacets.map((t) => <FacetChip key={t} label={t} active={fType.has(t)} onClick={() => toggleIn(fType, setFType, t)} />)}
          {srcFacets.length > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-border" />}
          {srcFacets.map((s) => <FacetChip key={s} label={s} active={fSrc.has(s)} onClick={() => toggleIn(fSrc, setFSrc, s)} />)}
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <FacetChip label="high importance" icon={<Star className="h-3 w-3" />} active={highImp} onClick={() => setHighImp((v) => !v)} />
          {hasFilters ? (
            <button onClick={clearTuners} className="ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> clear
            </button>
          ) : (
            <span className="num ms-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Filter className="h-3 w-3" /> {results.length} shown</span>
          )}
        </div>
      )}

      {state.ran && !search.isPending && results.length > 0 && (
        <div className="num text-[11px] text-muted-foreground">
          {results.length}{hasFilters ? ` of ${raw.length}` : ""} result{results.length === 1 ? "" : "s"} · {scoped ? namespace : allActive ? "all brains" : [...selected].join(", ")}
        </div>
      )}

      {/* Caveat — thin/empty recall shown as a styled state, not a raw error. */}
      {state.ran && !search.isPending && raw.length === 0 && !state.error && (
        <section className="border border-border">
          <div aria-hidden className="grid-hatch h-3 border-b border-border" />
          <div className="px-4 py-10 text-center">
            <div className="text-sm font-medium text-foreground">
              {scoped ? <>This brain has no memory of “{state.q}”.</> : <>No brain remembers “{state.q}”.</>}
            </div>
            <p className="mt-1 text-sm font-light text-muted-foreground">Try a shorter, keyword-forward query — or this may be a genuine knowledge gap.</p>
          </div>
        </section>
      )}
      {/* Filtered everything out. */}
      {state.ran && !search.isPending && raw.length > 0 && results.length === 0 && (
        <div className="border border-border px-4 py-8 text-center text-sm text-muted-foreground">
          All {raw.length} results are filtered out — loosen the tuners above.
        </div>
      )}

      {results.length > 0 && (
        <div className="grid-cells grid-cols-1">
          {results.map((r) => (
            <ResultRow key={`${r.namespace}:${r.id}`} r={r} onSaved={(content) => patch(r.id, content)} />
          ))}
        </div>
      )}
    </div>
  );
}
