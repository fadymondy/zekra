import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowUpDown, FileText, Network, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";

import { IconButton } from "../../components/chrome";
import { NoteRow, type OpenHow } from "../../components/note-row";
import type { Note } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import { showMenu } from "../../lib/native-menu";
import { NOTE_SORTS, type NoteSort } from "./notes-model";

/*
The workspace's content list — Mail / Notes shape, between the source list
and the editor:

  [ All Notes           10 ]        list name + count (the sidebar picks it)
  [ ⌕ Search            ⇅ ]        filter field · sort (a native menu)
  Pinned
    rows…
  Today / Yesterday / Previous 7 Days / Previous 30 Days / <Month> / Earlier
    rows…                           two lines, date on the trailing side

Rows are plain buttons: ↑/↓ walk the list and Enter opens, right-click pops
the note's native menu, double-click opens it in its own window. The graph
explorer (MH-306, `tree`) swaps in for the list behind the network button.
*/

export type ListFilter = "all" | "pinned" | "recent" | "archived";

const LIST_KEYS: Record<ListFilter, TKey> = {
  all: "sb.allNotes",
  pinned: "sb.pinned",
  recent: "sb.recentNotes",
  archived: "sb.archived",
};
const SORT_KEYS: Record<NoteSort, TKey> = {
  updated: "notes.x.sort.updated",
  created: "notes.x.sort.created",
  title: "notes.x.sort.title",
};

type Group = { key: string; label: string; notes: Note[] };

/** Pinned first (in "all"), then date sections by last update. */
function useGroups(notes: Note[], filter: ListFilter, sort: NoteSort): Group[] {
  const { t, locale } = useI18n();
  if (sort === "title") return [{ key: "all", label: "", notes }];
  const out: Group[] = [];
  const pinned = filter === "all" ? notes.filter((n) => n.pinned) : [];
  if (pinned.length) out.push({ key: "pinned", label: t("list.pinned"), notes: pinned });
  const rest = pinned.length ? notes.filter((n) => !n.pinned) : notes;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const loc = locale === "ar" ? "ar" : "en";
  const by = new Map<string, Group>();
  for (const n of rest) {
    const d = new Date(n.updatedAt);
    const t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((today - t0) / 86_400_000);
    let key: string;
    let label: string;
    if (days <= 0) [key, label] = ["today", t("grp.today")];
    else if (days === 1) [key, label] = ["yesterday", t("grp.yesterday")];
    else if (days < 7) [key, label] = ["week", t("grp.week")];
    else if (days < 30) [key, label] = ["month", t("grp.month")];
    else if (d.getFullYear() === now.getFullYear()) [key, label] = [`m${d.getMonth()}`, d.toLocaleDateString(loc, { month: "long" })];
    else [key, label] = [`y${d.getFullYear()}`, String(d.getFullYear())];
    let g = by.get(key);
    if (!g) {
      g = { key, label, notes: [] };
      by.set(key, g);
      out.push(g);
    }
    g.notes.push(n);
  }
  return out;
}

export function NotesSidebar({
  notes,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  filter,
  sort,
  onSort,
  query,
  onQuery,
  selectedId,
  openIds,
  onOpen,
  onRowMenu,
  tree,
}: {
  notes: Note[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  filter: ListFilter;
  sort: NoteSort;
  onSort: (s: NoteSort) => void;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  openIds: Set<string>;
  onOpen: (note: Note, how: OpenHow | "open-window") => void;
  onRowMenu: (note: Note, e: MouseEvent) => void;
  /** The brain's entity explorer, shown instead of the list when toggled. */
  tree?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const [showTree, setShowTree] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const groups = useGroups(notes, filter, sort);

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

  async function sortMenu(e: MouseEvent<HTMLButtonElement>) {
    const id = await showMenu(
      NOTE_SORTS.map((s) => ({ id: s, type: "radio" as const, checked: s === sort, label: t(SORT_KEYS[s]) })),
      e.currentTarget,
    );
    if (id) onSort(id as NoteSort);
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
    <div className="app-chrome flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-0.5">
          <InputGroup className="field h-7 rounded-md">
            <InputGroupAddon className="ps-2 [&>svg]:size-3.5">
              <Search />
            </InputGroupAddon>
            <InputGroupInput
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
              className="h-7 text-[13px]"
            />
            {query ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label={t("notes.x.clearSearch")} onClick={() => onQuery("")} className="size-5">
                  <X className="size-3" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <IconButton label={t("notes.x.sort")} onClick={(e) => void sortMenu(e)}>
            <ArrowUpDown />
          </IconButton>
          {tree ? (
            <IconButton label={t("tree.title")} active={showTree} onClick={() => setShowTree((v) => !v)}>
              <Network />
            </IconButton>
          ) : null}
        </div>
      </div>

      {showTree && tree ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">{tree}</div>
      ) : (
        <div ref={listRef} onKeyDown={onListKey} className="list-pane min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading && notes.length === 0 ? (
            <div aria-busy className="flex flex-col gap-1 pt-1">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="flex flex-col gap-1.5 px-2.5 py-2">
                  <Skeleton className="h-3 rounded-sm" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                  <Skeleton className="h-2.5 w-full rounded-sm opacity-70" />
                </div>
              ))}
            </div>
          ) : error && notes.length === 0 ? (
            <Empty className="gap-3 p-6">
              <EmptyHeader>
                <EmptyTitle className="text-[13px]">{t("notes.x.failed")}</EmptyTitle>
                <EmptyDescription className="text-xs">{error}</EmptyDescription>
              </EmptyHeader>
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t("kit.retry")}
              </Button>
            </Empty>
          ) : notes.length === 0 ? (
            <Empty className="gap-2 p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="mb-1 size-8 bg-muted text-muted-foreground">
                  <FileText className="size-4 stroke-[1.5]" />
                </EmptyMedia>
                <EmptyDescription className="text-xs">{empty}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            groups.map((g) => (
              <section key={g.key} aria-label={g.label || undefined}>
                {g.label ? (
                  <h3 className="list-group-header sticky top-0 z-10 bg-background/95 px-2.5 pt-2.5 pb-1 backdrop-blur-sm">
                    {g.label}
                  </h3>
                ) : null}
                <div className="flex flex-col gap-px">
                  {g.notes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      selected={note.id === selectedId}
                      open={openIds.has(note.id)}
                      onMenu={(e) => onRowMenu(note, e)}
                      onOpen={(how) => onOpen(note, how)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
          {hasMore ? (
            <div ref={sentinel} className="p-3 text-center text-xs text-muted-foreground">
              {loadingMore ? t("notes.loadingMore") : " "}
            </div>
          ) : null}
          {error && notes.length > 0 ? <p className="p-3 text-center text-xs text-destructive">{t("notes.x.loadMoreFailed")}</p> : null}
        </div>
      )}
    </div>
  );
}
