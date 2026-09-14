import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes, Plus, Search, Rocket, Download, Trash2, MoreHorizontal,
  ArrowRight, HelpCircle, LayoutGrid, List, Lock, Loader2, CheckCircle2,
} from "lucide-react";
import {
  Button, Input, Badge, StatusBadge, EmptyState, Skeleton,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  ToggleGroup, ToggleGroupItem,
} from "@togo-framework/ui";
import { brainApi, type BrainDetail, type NamespaceInfo } from "../lib/brain";
import { LaunchSessionModal } from "../components/launch-session-modal";
import { Hatch, PageHeading, StatCells } from "../components/page";

/* ---------------------------------------------------------------- helpers -- */

function relTime(iso?: string): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  const units: [number, string][] = [
    [60, "s"], [3600, "m"], [86400, "h"], [604800, "d"], [2629800, "w"], [31557600, "mo"],
  ];
  let prev = 1;
  for (const [limit, label] of units) {
    if (s < limit) return `${Math.floor(s / prev)}${label} ago`;
    prev = limit;
  }
  return `${Math.floor(s / 31557600)}y ago`;
}

function nf(n?: number) { return (n ?? 0).toLocaleString(); }

/** A brain's identity cell: a square hairline tile with a two-letter mono monogram and the
 *  brand's memory square in the corner. One accent for every brain — identity comes from the
 *  name, not from a per-brain hue. */
export function BrainAvatar({ namespace, size = 40 }: { namespace: string; size?: number }) {
  const mono = namespace.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "··";
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 items-center justify-center border border-border bg-muted font-mono font-medium text-foreground"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.3) }}
    >
      {mono}
      <span className="absolute -end-px -top-px size-2 bg-active" />
    </span>
  );
}

/* ------------------------------------------------------------ create modal -- */

function NewBrainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const create = useMutation({
    mutationFn: () =>
      brainApi.retain({
        namespace: slug,
        content: `Brain "${slug}" created from the console.${desc.trim() ? " " + desc.trim() : ""}`,
        sourceKind: "system",
        sourceRef: "console/new-brain",
      }),
    onSuccess: (res) => {
      if ((res as { error?: unknown }).error) return;
      qc.invalidateQueries({ queryKey: ["brain", "namespaces"] });
      qc.invalidateQueries({ queryKey: ["brain", "stats"] });
      setName(""); setDesc(""); onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New brain</DialogTitle>
          <DialogDescription>
            A brain is a namespace. Creating one seeds a marker so it exists and is connectable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. research" />
            {name && slug !== name.trim().toLowerCase() && (
              <p className="text-xs text-muted-foreground">Namespace: <code className="font-mono">{slug || "—"}</code></p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description <span className="text-muted-foreground">(optional)</span></label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this brain holds" />
          </div>
          {(create.data as { error?: { message?: string } } | undefined)?.error && (
            <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-tone-danger">
              {(create.data as { error: { message?: string } }).error.message ?? "Could not create brain"}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!slug || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create brain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------ delete modal -- */

function DeleteBrainDialog({ namespace, onClose }: { namespace: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => brainApi.deleteBrain({ namespace, confirm: namespace }),
    onSuccess: (res) => {
      if (res.error) return;
      qc.invalidateQueries({ queryKey: ["brain", "namespaces"] });
      qc.invalidateQueries({ queryKey: ["brain", "stats"] });
      onClose();
    },
  });
  const match = typed === namespace;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-tone-danger">Delete brain</DialogTitle>
          <DialogDescription>
            This permanently removes every memory in <code className="font-mono text-foreground">{namespace}</code>. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            Type <span className="font-mono font-medium text-foreground">{namespace}</span> to confirm.
          </label>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={namespace} />
          {del.data?.error && (
            <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-tone-danger">
              {del.data.error.code}: {del.data.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => del.mutate()} disabled={!match || del.isPending}>
            {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete brain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- row-level menu -- */

function BrainActions({ namespace, onLaunch, onDelete }: { namespace: string; onLaunch: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative z-20 h-8 w-8 shrink-0" aria-label={`Actions for ${namespace}`} onClick={(e) => e.preventDefault()}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-30">
        <DropdownMenuItem onSelect={onLaunch}><Rocket className="h-4 w-4" /> Launch session</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={brainApi.exportUrl(namespace)}><Download className="h-4 w-4" /> Export JSONL</a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" /> Delete brain</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TypeTags({ detail }: { detail?: BrainDetail }) {
  if (!detail) return <Skeleton className="h-5 w-40" />;
  const types = Object.entries(detail.types).sort((a, b) => b[1] - a[1]);
  if (types.length === 0) return <span className="text-xs text-muted-foreground">No memory types yet</span>;
  const top = types.slice(0, 3);
  const rest = types.length - top.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {top.map(([t, n]) => (
        <Badge key={t} variant="secondary" className="font-normal">
          {t}<span className="num ms-1.5 text-muted-foreground">{nf(n)}</span>
        </Badge>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest} more</span>}
    </div>
  );
}

/* ------------------------------------------------------------- brain cell -- */

function useDetail(namespace: string) {
  const q = useQuery({ queryKey: ["brain", "detail", namespace], queryFn: () => brainApi.brainDetail(namespace) });
  return q.data && !q.data.error ? (q.data as BrainDetail) : undefined;
}

/** One figure in a card's metric row: mono value over a micro-label. */
function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="num truncate text-[15px] font-medium text-foreground">{value}</div>
      <div className="micro mt-1 text-muted-foreground">{label}</div>
    </div>
  );
}

/** A brain as a hairline cell. No lift, no shadow: hover only lifts the ground one step and
 *  draws the active rule along the top. */
function BrainCard({ b, onLaunch, onDelete }: { b: NamespaceInfo; onLaunch: () => void; onDelete: () => void }) {
  const d = useDetail(b.namespace);
  return (
    <div className="group relative flex flex-col bg-card transition-colors hover:bg-muted/50 focus-within:bg-muted/50">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-transparent transition-colors group-hover:bg-active" />
      <Link
        to="/b/$namespace" params={{ namespace: b.namespace }}
        aria-label={`Open ${b.namespace}`}
        className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="relative z-10 flex items-start gap-3 p-4">
        <div className="pointer-events-none"><BrainAvatar namespace={b.namespace} size={44} /></div>
        <div className="pointer-events-none min-w-0 flex-1">
          <div dir="ltr" className="truncate text-base font-medium text-foreground">{b.namespace}</div>
          <div className="num mt-1 text-[11px] text-muted-foreground">updated {relTime(b.lastAt)}</div>
        </div>
        <div className="-me-1 -mt-1"><BrainActions namespace={b.namespace} onLaunch={onLaunch} onDelete={onDelete} /></div>
      </div>

      <div className="pointer-events-none relative z-10 grid grid-cols-3 divide-x divide-border border-y border-border rtl:divide-x-reverse">
        <Metric value={nf(b.memories)} label="memories" />
        <Metric value={d ? nf(d.recalls) : "—"} label="recalls" />
        <Metric value={d ? nf(Object.keys(d.types).length) : "—"} label="types" />
      </div>

      <div className="pointer-events-none relative z-10 min-h-[3.25rem] px-4 py-3"><TypeTags detail={d} /></div>

      <div className="pointer-events-none relative z-10 mt-auto flex items-center justify-between border-t border-border px-4 py-2.5">
        {d && d.openGaps > 0
          ? <StatusBadge tone="warning"><HelpCircle className="h-3 w-3" /> {d.openGaps} open {d.openGaps === 1 ? "gap" : "gaps"}</StatusBadge>
          : <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-tone-ok" /> No open gaps
            </span>}
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
          Open <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
        </span>
      </div>
    </div>
  );
}

function BrainRow({ b, onLaunch, onDelete }: { b: NamespaceInfo; onLaunch: () => void; onDelete: () => void }) {
  const d = useDetail(b.namespace);
  return (
    <div className="group relative flex items-center gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
      <Link to="/b/$namespace" params={{ namespace: b.namespace }} aria-label={`Open ${b.namespace}`} className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="pointer-events-none"><BrainAvatar namespace={b.namespace} size={36} /></div>
      <div className="pointer-events-none min-w-0 flex-1">
        <div dir="ltr" className="truncate font-medium text-foreground">{b.namespace}</div>
        <div className="num mt-0.5 truncate text-[11px] text-muted-foreground">
          {relTime(b.lastAt)}
          {/* memories stay visible on mobile, where the stat columns are hidden */}
          <span className="sm:hidden"> · {nf(b.memories)} memories</span>
        </div>
      </div>

      <div className="pointer-events-none hidden items-center gap-8 sm:flex">
        {[
          [nf(b.memories), "memories"],
          [d ? nf(d.recalls) : "—", "recalls"],
          [d ? nf(Object.keys(d.types).length) : "—", "types"],
        ].map(([v, l]) => (
          <div key={l} className="text-end">
            <div className="num text-sm font-medium text-foreground">{v}</div>
            <div className="micro mt-0.5 text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>

      {d && d.openGaps > 0 && (
        <StatusBadge tone="warning" className="pointer-events-none hidden md:inline-flex">
          <HelpCircle className="h-3 w-3" /> {d.openGaps}
        </StatusBadge>
      )}
      <ArrowRight className="pointer-events-none hidden h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground sm:block rtl:-scale-x-100" />
      <div className="relative z-20"><BrainActions namespace={b.namespace} onLaunch={onLaunch} onDelete={onDelete} /></div>
    </div>
  );
}

/* ----------------------------------------------------------------- the hub -- */

type Sort = "recent" | "name" | "memories";
type ViewMode = "grid" | "list";

export function BrainsHub() {
  const q = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces, refetchInterval: 15_000 });
  const stats = useQuery({ queryKey: ["brain", "stats"], queryFn: brainApi.stats, refetchInterval: 15_000 });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [view, setView] = useState<ViewMode>("grid");
  const [deleteNs, setDeleteNs] = useState<string | null>(null);
  const [launchNs, setLaunchNs] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const brains = useMemo(() => {
    let rows = q.data?.brains ?? [];
    const term = search.trim().toLowerCase();
    if (term) rows = rows.filter((b) => b.namespace.toLowerCase().includes(term));
    return [...rows].sort((a, b) => {
      if (sort === "name") return a.namespace.localeCompare(b.namespace);
      if (sort === "memories") return b.memories - a.memories;
      return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
    });
  }, [q.data, search, sort]);

  const s = stats.data;
  const loading = q.isLoading;
  const v = (n?: number) => (loading ? "—" : nf(n));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PageHeading
        eyebrow="Memory organ"
        title="Brains"
        description="Each brain is an isolated memory namespace. Open one to explore its graph, sessions, sources and gaps."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New brain</Button>}
      />

      <StatCells
        className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        stats={[
          { label: "Brains", value: v(s?.brains ?? brains.length) },
          { label: "Memories", value: v(s?.memories) },
          { label: "Graph nodes", value: v(s?.entities) },
          { label: "Recalls · 24h", value: v(s?.recalls24h), tone: s?.recalls24h ? "ok" : undefined },
          { label: "Open gaps", value: v(s?.openGaps), tone: s?.openGaps ? "warn" : "muted" },
        ]}
      />

      <Hatch />

      {/* Toolbar — search + sort + view, stacks on mobile */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brains…" className="ps-9" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(val) => setSort(val as Sort)}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently updated</SelectItem>
              <SelectItem value="name">Name (A–Z)</SelectItem>
              <SelectItem value="memories">Most memories</SelectItem>
            </SelectContent>
          </Select>
          <ToggleGroup type="single" value={view} onValueChange={(val) => val && setView(val as ViewMode)} className="hidden sm:flex">
            <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view"><List className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Content — hairline cells, never floating cards */}
      {loading ? (
        <div className="grid-cells grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card p-4"><Skeleton className="h-44" /></div>)}
        </div>
      ) : brains.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title={search ? "No brains match your search" : "No brains yet"}
          description={search ? "Try a different name." : "A brain forms the moment an agent retains a memory into a namespace — or create one now."}
          action={!search ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New brain</Button> : undefined}
        />
      ) : view === "grid" ? (
        <div className="grid-cells grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {brains.map((b) => <BrainCard key={b.namespace} b={b} onLaunch={() => setLaunchNs(b.namespace)} onDelete={() => setDeleteNs(b.namespace)} />)}
        </div>
      ) : (
        <div className="grid-cells grid-cols-1">
          {brains.map((b) => <BrainRow key={b.namespace} b={b} onLaunch={() => setLaunchNs(b.namespace)} onDelete={() => setDeleteNs(b.namespace)} />)}
        </div>
      )}

      {/* Admin pointer */}
      <div className="flex flex-wrap items-center gap-2 border border-border px-4 py-3 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> Tokens, users and cross-brain access controls live under
        <Link to="/admin/users" className="text-foreground underline decoration-violet underline-offset-4">Admin</Link>.
        <span className="num ms-auto hidden items-center gap-4 text-[11px] sm:flex">
          <span>{nf(s?.entities)} nodes</span>
          <span>{nf(s?.sessions24h)} sessions · 24h</span>
        </span>
      </div>

      <NewBrainDialog open={creating} onClose={() => setCreating(false)} />
      {deleteNs && <DeleteBrainDialog namespace={deleteNs} onClose={() => setDeleteNs(null)} />}
      {launchNs && <LaunchSessionModal namespace={launchNs} onClose={() => setLaunchNs(null)} />}
    </div>
  );
}
