import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { filterSort, formatCount, SORTS, type BrainListItem, type BrainStats, type Sort } from "@mobile/features/brains/brains-core";

import { Spotlight } from "../components/spotlight";
import { BrainCard, type BrainAction } from "../features/brains/brain-card";
import { DeleteBrainDialog, NewBrainDialog } from "../features/brains/brain-dialogs";
import { exportBrain, useBrainList, useBrainStats } from "../features/brains/brains-data";
import { ReadingTheme } from "../features/editor/reading-theme";
import { useI18n } from "../lib/i18n";
import { useCommand } from "../shell/commands";
import { useRouter } from "../shell/router";
import { useAuthed } from "../shell/session";
import { toast } from "../shell/toast";

/*
The Brains home (MH-450) — the web console's brains page and the mobile
Brains tab (mobile/app/(tabs)/(brains)/brains.tsx) on a desktop grid:

  overview   fleet stats strip (GET /api/brain/stats, refreshed every 15s)
  toolbar    client-side search (namespace, name, description) and sort
             (recent / name / memories) over /mine merged with /namespaces
  grid       brain cards, 1–4 columns by width, hairline rules between them
  actions    right-click or "…": open, notes / presentations / vault, export
             NDJSON (native save dialog), delete (owners/admins, type-to-confirm)

Owns "new-brain" (⇧⌘N) while mounted; the shell's fallback navigates here and
defers the command, so the dialog opens from anywhere.
*/

const SORT_KEYS = { recent: "brains.sort.recent", name: "brains.sort.name", memories: "brains.sort.memories" } as const;

export function BrainsRoute() {
  const { t, locale } = useI18n();
  const { token, patch } = useAuthed();
  const { navigate } = useRouter();
  const { brains } = useBrainList();
  const stats = useBrainStats().data;
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<Sort>(() => {
    const saved = localStorage.getItem("zekra.desktop.brains-sort") as Sort | null;
    return saved && SORTS.includes(saved) ? saved : "recent";
  });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BrainListItem | null>(null);

  useCommand("new-brain", () => setCreating(true));

  const rows = useMemo(() => (brains ? filterSort(brains, term, sort, locale) : null), [brains, term, sort, locale]);

  function open(ns: string, tab: "notes" | "presentations" | "vault" = "notes") {
    void patch({ activeBrain: ns });
    navigate({ name: "brain", ns, tab });
  }

  function onAction(brain: BrainListItem, action: BrainAction) {
    switch (action) {
      case "open":
      case "notes":
        open(brain.namespace, "notes");
        return;
      case "presentations":
      case "vault":
        open(brain.namespace, action);
        return;
      case "export": {
        const id = toast.loading(t("brains.export.preparing"));
        void exportBrain(token, brain.namespace)
          .then((path) => {
            toast.dismiss(id);
            if (path) toast.success(t("brainsx.exported", { name: path.split(/[\\/]/).pop() ?? path }));
          })
          .catch(() => {
            toast.dismiss(id);
            toast.error(t("brains.export.failed"));
          });
        return;
      }
      case "delete":
        setDeleting(brain);
        return;
    }
  }

  return (
    <div className="grid-hatch min-h-0 flex-1 overflow-y-auto">
      <Spotlight />
      <ReadingTheme />
      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-medium text-grid-fg">{t("brainsx.title")}</h1>
            <p className="mt-0.5 text-sm text-grid-muted">{t("brainsx.lead")}</p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t("brains.new.button")}
          </Button>
        </header>

        <StatsStrip stats={stats} fallbackBrains={brains?.length} />

        <div className="my-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setTerm("");
              }}
              placeholder={t("brains.searchPlaceholder")}
              className="ps-8 pe-8"
            />
            {term ? (
              <button
                type="button"
                aria-label={t("brains.clearSearch")}
                onClick={() => setTerm("")}
                className="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-grid-muted hover:text-grid-fg"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div role="radiogroup" aria-label={t("notes.x.sort")} className="flex items-center rounded-lg border border-line bg-grid-card p-0.5">
            {SORTS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sort === s}
                onClick={() => {
                  setSort(s);
                  localStorage.setItem("zekra.desktop.brains-sort", s);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs transition-colors",
                  sort === s ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg",
                )}
              >
                {t(SORT_KEYS[s])}
              </button>
            ))}
          </div>
        </div>

        {!rows ? (
          <div className="grid grid-cols-1 gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-64 animate-pulse bg-grid-card" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-y border-line bg-grid-card px-6 py-16 text-center">
            <p className="text-base font-medium text-grid-fg">
              {term ? t("brains.emptySearch") : t("brains.emptyTitle")}
            </p>
            <p className="max-w-md text-sm text-grid-muted">{term ? t("brains.emptySearchBody") : t("brains.emptyLead")}</p>
            {!term ? (
              <Button className="mt-3" onClick={() => setCreating(true)}>
                <Plus />
                {t("brains.new.button")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((brain) => (
              <BrainCard key={brain.namespace} brain={brain} token={token} onAction={onAction} />
            ))}
          </div>
        )}
      </div>

      <NewBrainDialog open={creating} onOpenChange={setCreating} onCreated={(ns) => open(ns)} />
      <DeleteBrainDialog
        brain={deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      />
    </div>
  );
}

function StatsStrip({ stats, fallbackBrains }: { stats: BrainStats | undefined; fallbackBrains?: number }) {
  const { t } = useI18n();
  const v = (n: number | undefined) => (n === undefined ? "—" : formatCount(n));
  const items: { label: string; value: string; hue?: string }[] = [
    { label: t("brains.stat.brains"), value: v(stats?.brains ?? fallbackBrains) },
    { label: t("brains.stat.memories"), value: v(stats?.memories) },
    { label: t("brains.stat.nodes"), value: v(stats?.entities) },
    { label: t("brains.stat.recalls24h"), value: v(stats?.recalls24h), hue: stats?.recalls24h ? "var(--grid-ok)" : undefined },
    { label: t("brains.stat.openGaps"), value: v(stats?.openGaps), hue: stats?.openGaps ? "#C9A227" : undefined },
  ];
  return (
    <section aria-label={t("brains.overview")}>
      <p className="grid-micro mb-1.5 text-grid-muted">{t("brains.overview")}</p>
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        {items.map((s) => (
          <div key={s.label} className="bg-grid-card px-4 py-3">
            <span dir="ltr" className="block font-mono text-xl text-grid-fg tabular-nums" style={s.hue ? { color: s.hue } : undefined}>
              {s.value}
            </span>
            <span className="grid-micro mt-0.5 block truncate text-grid-muted">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
