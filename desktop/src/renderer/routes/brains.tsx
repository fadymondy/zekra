import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { BrainCircuit, ChevronDown, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { canDelete, filterSort, formatAgo, formatCount, SORTS, type BrainListItem, type Sort } from "@mobile/features/brains/brains-core";

import { BrainAvatar } from "../components/brain-avatar";
import { IconButton } from "../components/chrome";
import { Spotlight } from "../components/spotlight";
import type { BrainAction } from "../features/brains/brain-card";
import { DeleteBrainDialog, NewBrainDialog } from "../features/brains/brain-dialogs";
import { exportBrain, useBrainList, useBrainStats } from "../features/brains/brains-data";
import { ReadingTheme } from "../features/editor/reading-theme";
import { useI18n, type TKey } from "../lib/i18n";
import { SEP, showMenu } from "../lib/native-menu";
import { useCommand } from "../shell/commands";
import { useRouter } from "../shell/router";
import { useAuthed } from "../shell/session";
import { toast } from "../shell/toast";
import { ToolbarActions, WindowTitle } from "../shell/toolbar";

/*
All Brains (MH-450) — a Finder-style list view of every brain:

  title      "Brains" · fleet counts in the subtitle (GET /api/brain/stats)
  toolbar    client-side search (namespace, name, description), New Brain
  columns    name (avatar, description) · role · memories · last update;
             the Name / Memories / Updated headers sort (persisted)
  rows       click selects, double-click / Enter opens; right-click is a
             native menu: open, notes / presentations / vault, export NDJSON
             (native save dialog), delete (owners/admins, type-to-confirm)

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
  const [selected, setSelected] = useState<string | null>(null);

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

  function rowMenu(brain: BrainListItem, e: ReactMouseEvent) {
    e.preventDefault();
    void showMenu(
      [
        { id: "open", label: t("brains.menu.open") },
        SEP,
        { id: "notes", label: t("brains.menu.notes") },
        { id: "presentations", label: t("brains.menu.presentations") },
        { id: "vault", label: t("brains.menu.vault") },
        SEP,
        { id: "export", label: `${t("brains.menu.export")}…` },
        ...(canDelete(brain.role) ? [SEP, { id: "delete", label: `${t("brains.menu.delete")}…` }] : []),
      ],
      e,
    ).then((id) => id && onAction(brain, id as BrainAction));
  }

  const subtitle = stats
    ? `${formatCount(stats.brains)} ${t("brains.stat.brains")} · ${formatCount(stats.memories)} ${t("brains.stat.memories")}`
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <Spotlight />
      <ReadingTheme />
      <WindowTitle title={t("home.title")} subtitle={subtitle} />
      <ToolbarActions>
        <InputGroup className="field h-7 w-56 rounded-md">
          <InputGroupAddon className="ps-2 [&>svg]:size-3.5">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTerm("");
            }}
            placeholder={t("brains.searchPlaceholder")}
            className="h-7 text-ui"
          />
          {term ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label={t("brains.clearSearch")} onClick={() => setTerm("")} className="size-5">
                <X className="size-3" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <IconButton label={t("sb.newBrain")} shortcut="⇧⌘N" onClick={() => setCreating(true)}>
          <Plus />
        </IconButton>
      </ToolbarActions>

      {/* A Finder-style list view: sortable column headers, dense rows. */}
      <div role="grid" aria-label={t("home.title")} className="list-pane flex min-h-0 flex-1 flex-col">
        <div role="row" className="app-chrome grid shrink-0 grid-cols-[minmax(0,1fr)_110px_110px_130px] items-center gap-3 border-b border-border/60 px-5 text-ui-sm text-muted-foreground" style={{ height: 28 }}>
          {([
            ["name", t("brains.sort.name")],
            [null, t("home.role")],
            ["memories", t("brains.sort.memories")],
            ["recent", t("brains.sort.recent")],
          ] as const).map(([key, label], i) => (
            <button
              key={i}
              type="button"
              role="columnheader"
              disabled={!key}
              aria-sort={key && sort === key ? "descending" : undefined}
              onClick={() => {
                if (!key) return;
                setSort(key);
                localStorage.setItem("zekra.desktop.brains-sort", key);
              }}
              className={cn(
                "flex items-center gap-1 truncate text-start font-medium disabled:opacity-100",
                i > 0 && "justify-end",
                key && sort === key && "text-foreground",
              )}
            >
              {label}
              {key && sort === key ? <ChevronDown className="size-3" /> : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {!rows ? (
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="h-3 flex-1 rounded-sm" style={{ maxWidth: `${40 + i * 7}%` }} />
              </div>
            ))
          ) : rows.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-10 rounded-xl bg-muted text-muted-foreground">
                  <BrainCircuit className="size-5 stroke-[1.5]" />
                </EmptyMedia>
                <EmptyTitle className="text-[15px] font-semibold">{term ? t("brains.emptySearch") : t("brains.emptyTitle")}</EmptyTitle>
                <EmptyDescription className="text-ui">{term ? t("brains.emptySearchBody") : t("brains.emptyLead")}</EmptyDescription>
              </EmptyHeader>
              {!term ? (
                <EmptyContent>
                  <Button onClick={() => setCreating(true)}>
                    <Plus />
                    {t("brains.new.button")}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            rows.map((b) => (
              <button
                key={b.namespace}
                type="button"
                role="row"
                data-selected={selected === b.namespace || undefined}
                onClick={() => setSelected(b.namespace)}
                onDoubleClick={() => open(b.namespace)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") open(b.namespace);
                }}
                onContextMenu={(e) => {
                  setSelected(b.namespace);
                  rowMenu(b, e);
                }}
                className="list-row grid w-full grid-cols-[minmax(0,1fr)_110px_110px_130px] items-center gap-3 px-3 py-2 text-start"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <BrainAvatar brain={b} token={token} size={28} />
                  <span className="grid min-w-0 leading-tight">
                    <span className="list-row-title truncate text-ui font-semibold" style={{ unicodeBidi: "plaintext" }}>
                      {b.displayName || b.namespace}
                    </span>
                    <span className="list-row-meta truncate text-ui-sm" dir="auto">
                      {b.description || b.namespace}
                    </span>
                  </span>
                </span>
                <span className="list-row-meta truncate text-end text-ui-sm">{b.role && ROLE_KEYS[b.role] ? t(ROLE_KEYS[b.role]) : "—"}</span>
                <span className="list-row-meta text-end text-ui-sm tabular-nums">{formatCount(b.memories)}</span>
                <span className="list-row-meta truncate text-end text-ui-sm">{formatAgo(b.lastAt, locale)}</span>
              </button>
            ))
          )}
        </div>
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

const ROLE_KEYS: Record<string, TKey> = {
  admin: "brains.role.admin",
  owner: "brains.role.owner",
  editor: "brains.role.editor",
  viewer: "brains.role.viewer",
};
