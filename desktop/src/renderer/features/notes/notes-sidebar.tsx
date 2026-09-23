import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpDown, Check, FilePlus2, Network, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { NoteRow, type OpenHow } from "../../components/note-row";
import type { Note } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import { NOTE_FILTERS, NOTE_SORTS, type NoteFilter, type NoteSort } from "./notes-model";

/*
The workspace's start pane: filter field, the All / Pinned / Archived strip,
sort, and the infinite list (pinned first). Rows are plain buttons, so ↑/↓
walk the list and Enter opens — like a native source list. The graph
explorer (MH-306, `tree`) swaps in for the list behind the network button.
*/

const FILTER_KEYS: Record<NoteFilter, TKey> = {
  all: "notes.x.filter.all",
  pinned: "notes.x.filter.pinned",
  archived: "notes.x.filter.archived",
};
const SORT_KEYS: Record<NoteSort, TKey> = {
  updated: "notes.x.sort.updated",
  created: "notes.x.sort.created",
  title: "notes.x.sort.title",
};

export function NotesSidebar({
  notes,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  filter,
  onFilter,
  sort,
  onSort,
  query,
  onQuery,
  selectedId,
  openIds,
  canWrite,
  onNew,
  onOpen,
  menuFor,
  tree,
}: {
  notes: Note[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  filter: NoteFilter;
  onFilter: (f: NoteFilter) => void;
  sort: NoteSort;
  onSort: (s: NoteSort) => void;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  openIds: Set<string>;
  canWrite: boolean;
  onNew: () => void;
  onOpen: (note: Note, how: OpenHow) => void;
  menuFor: (note: Note) => ReactNode;
  /** The brain's entity explorer, shown instead of the list when toggled. */
  tree?: ReactNode;
}) {
  const { t } = useI18n();
  const [showTree, setShowTree] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore();
    }, { root: listRef.current, rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, notes.length]);

  // Keep the selected row in view when it changes from elsewhere (a tab).
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-note-row="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-note-row]") ?? []);
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    e.preventDefault();
    next.focus();
  }

  const empty =
    query.trim() !== ""
      ? t("notes.x.noMatches", { q: query.trim() })
      : filter === "pinned"
        ? t("notes.x.emptyPinned")
        : filter === "archived"
          ? t("notes.x.emptyArchived")
          : t("notes.x.empty");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onQuery("");
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.querySelector<HTMLElement>("[data-note-row]")?.focus();
              }
            }}
            placeholder={t("notes.x.search")}
            aria-label={t("notes.x.search")}
            className="h-8 ps-7 pe-7 text-sm"
          />
          {query ? (
            <button
              type="button"
              aria-label={t("notes.x.clearSearch")}
              onClick={() => onQuery("")}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-grid-muted hover:text-grid-fg"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={t("notes.x.sort")} title={t("notes.x.sort")} />}
          >
            <ArrowUpDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("notes.x.sort")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSort(v as NoteSort)}>
                {NOTE_SORTS.map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {t(SORT_KEYS[s])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {tree ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("tree.title")}
            aria-pressed={showTree}
            title={t("tree.title")}
            onClick={() => setShowTree((v) => !v)}
            className={cn(showTree && "bg-grid-soft text-grid-fg")}
          >
            <Network />
          </Button>
        ) : null}
        {canWrite ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("notes.x.new")} title={`${t("notes.x.new")}  ⌘N`} onClick={onNew}>
            <FilePlus2 />
          </Button>
        ) : null}
      </div>

      {showTree && tree ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">{tree}</div>
      ) : (
        <>
          {/* FilterStrip: All / Pinned / Archived */}
          <div role="radiogroup" aria-label={t("notes.x.filter.all")} className="mx-2.5 mb-2 flex rounded-lg border border-line bg-grid-card p-0.5">
            {NOTE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                onClick={() => onFilter(f)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs transition-colors",
                  filter === f ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg",
                )}
              >
                {filter === f ? <Check className="size-3" /> : null}
                {t(FILTER_KEYS[f])}
              </button>
            ))}
          </div>

          <div ref={listRef} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto border-t border-line">
            {loading && notes.length === 0 ? (
              <div aria-busy className="space-y-px">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="flex gap-2.5 border-b border-line px-3 py-3">
                    <span className="size-4 animate-pulse rounded bg-grid-soft" />
                    <span className="flex-1 space-y-1.5">
                      <span className="block h-3 w-2/3 animate-pulse rounded bg-grid-soft" />
                      <span className="block h-2.5 w-full animate-pulse rounded bg-grid-soft" />
                    </span>
                  </div>
                ))}
              </div>
            ) : error && notes.length === 0 ? (
              <div className="space-y-2 p-4 text-sm">
                <p className="text-grid-danger">{error}</p>
                <Button size="sm" variant="outline" onClick={onRetry}>
                  {t("kit.retry")}
                </Button>
              </div>
            ) : notes.length === 0 ? (
              <p className="p-4 text-sm text-grid-muted">{empty}</p>
            ) : (
              notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  selected={note.id === selectedId}
                  open={openIds.has(note.id)}
                  menu={menuFor(note)}
                  onOpen={(how) => onOpen(note, how)}
                />
              ))
            )}
            {hasMore ? (
              <div ref={sentinel} className="p-3 text-center text-xs text-grid-muted">
                {loadingMore ? t("notes.loadingMore") : " "}
              </div>
            ) : null}
            {error && notes.length > 0 ? <p className="p-3 text-center text-xs text-grid-danger">{t("notes.x.loadMoreFailed")}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
