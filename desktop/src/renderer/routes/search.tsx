import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Clock, Loader2, Search as SearchIcon, StickyNote, X } from "lucide-react";

import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  groupByBrain,
  hitMeta,
  isLiveQuery,
  normalizeQuery,
  noteIdOf,
} from "@mobile/features/search/search-core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { BrainAvatar } from "../components/brain-avatar";
import { useRecentSearches } from "../features/search/recent";
import { zekraApi, type Brain, type Recalled } from "../lib/api";
import { WindowTitle } from "../shell/toolbar";
import { useI18n } from "../lib/i18n";
import { useCommand } from "../shell/commands";
import { useRouter, type Route } from "../shell/router";
import { useAuthed } from "../shell/session";

/*
The Search route — the full page behind the activity bar's Search (the ⌘K
spotlight is the quick version inside a brain).

  empty query  Apple-Health-like browse: recent searches (per account,
               features/search/recent.ts) and the brains, each a way to scope
               the search to it
  typing       live semantic recall (POST /api/brain/search) 300 ms after the
               last keystroke from 2 characters; Enter searches any query and
               remembers it
  results      grouped by brain, best brain first (mobile's search-core);
               opening a hit opens its note

Scope: `route.ns` narrows to one brain (a chip with ×). RouteView keys this
screen by ns, so changing scope starts a fresh screen with the query carried
over in the route.
*/

type Results = { query: string; hits: Recalled[] };

export function SearchRoute({ route }: { route: Extract<Route, { name: "search" }> }) {
  const { t } = useI18n();
  const { token, user, brains } = useAuthed();
  const { navigate, replace } = useRouter();
  const recent = useRecentSearches(user.id);
  const [query, setQuery] = useState(route.query ?? "");
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);
  /** The query the latest request was for — the live effect skips a repeat. */
  const ranFor = useRef("");

  const brainByNs = useMemo(() => new Map((brains ?? []).map((b) => [b.namespace, b])), [brains]);
  const scope = route.ns ? brainByNs.get(route.ns) : undefined;
  const brainName = (ns: string) => brainByNs.get(ns)?.displayName || ns || t("searchx.otherBrain");

  // ⌘K on this screen focuses the field instead of navigating again.
  useCommand("spotlight", () => {
    input.current?.focus();
    input.current?.select();
  });
  useEffect(() => input.current?.focus(), []);

  const run = useCallback(
    async (raw: string) => {
      const q = normalizeQuery(raw);
      if (!q) return;
      const mine = ++seq.current;
      ranFor.current = q;
      setBusy(true);
      setError(false);
      try {
        const res = await zekraApi.search(token, q, route.ns ? [route.ns] : undefined, SEARCH_LIMIT);
        if (seq.current === mine) setResults({ query: q, hits: res.results ?? [] });
      } catch {
        if (seq.current === mine) setError(true);
      } finally {
        if (seq.current === mine) setBusy(false);
      }
    },
    [token, route.ns],
  );

  // Live search, debounced.
  useEffect(() => {
    const q = normalizeQuery(query);
    if (q && q === ranFor.current) return; // Enter / a recent search already ran it
    ranFor.current = "";
    if (!q) {
      seq.current++;
      setResults(null);
      setBusy(false);
      setError(false);
      return;
    }
    if (!isLiveQuery(q)) {
      // Too short to search live: drop the previous query's results (Enter still searches).
      seq.current++;
      setResults(null);
      setBusy(false);
      return;
    }
    const timer = setTimeout(() => void run(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = normalizeQuery(query);
    if (!q) return;
    recent.push(q);
    void run(q);
  }

  function rerun(q: string) {
    setQuery(q);
    recent.push(q);
    void run(q);
  }

  function openHit(hit: Recalled) {
    recent.push(query);
    const ns = hit.namespace ?? route.ns;
    if (!ns) return;
    navigate({ name: "brain", ns, tab: "notes", noteId: noteIdOf(hit.sourceRef) });
  }

  const setScope = (ns?: string) => replace({ name: "search", query: normalizeQuery(query) || undefined, ns });

  const groups = useMemo(() => (results ? groupByBrain(results.hits) : []), [results]);
  const q = normalizeQuery(query);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WindowTitle title={t("search.title")} subtitle={scope ? scope.displayName || scope.namespace : undefined} />
      <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pt-6 pb-3">
        <div className="relative flex min-w-0 flex-1 items-center">
          <SearchIcon className="pointer-events-none absolute start-3 size-4 text-muted-foreground" />
          <Input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.title")}
            className="field h-9 rounded-lg ps-9 pe-9 text-[15px] shadow-none"
          />
          {busy ? (
            <Loader2 aria-label={t("nav.updating")} className="absolute end-3 size-4 animate-spin text-muted-foreground" />
          ) : query ? (
            <button
              type="button"
              aria-label={t("action.close")}
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
              className="absolute end-2.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {route.ns ? (
          <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-grid-gold/60 bg-grid-gold/10 ps-2 pe-1 text-xs text-grid-gold">
            <span className="max-w-40 truncate">{t("nav.scopeIn", { brain: scope?.displayName || route.ns })}</span>
            <button
              type="button"
              aria-label={t("searchx.clearScope")}
              title={t("nav.scopeAll")}
              onClick={() => setScope(undefined)}
              className="rounded-sm p-0.5 hover:bg-grid-gold/20"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : null}
      </form>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pb-10">
          {!q ? (
            <Browse
              recent={recent.list}
              onRecent={rerun}
              onRemoveRecent={recent.remove}
              onClearRecent={recent.clear}
              brains={brains}
              token={token}
              scopeNs={route.ns}
              onScope={(ns) => setScope(ns)}
            />
          ) : error && !results ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-destructive">{t("searchx.failed")}</p>
              <Button variant="outline" size="sm" onClick={() => void run(q)}>
                {t("action.retry")}
              </Button>
            </div>
          ) : !results ? (
            busy ? (
              <div className="flex flex-col gap-3 py-4" aria-label={t("search.searching")}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2 rounded-md border border-border/60 p-3">
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-2/3" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">{t("nav.liveHint")}</p>
            )
          ) : results.hits.length === 0 ? (
            <div className="py-6">
              <p className="text-sm font-medium">{t("search.empty")}</p>
              <p className="text-sm text-muted-foreground">{t("search.emptyBody")}</p>
            </div>
          ) : (
            <div className={cn("flex flex-col gap-6 pt-2 transition-opacity", busy && "opacity-60")}>
              <p className="grid-micro text-muted-foreground">
                {t("nav.resultCount", { count: results.hits.length })}
                {error ? <span className="ms-2 text-destructive">· {t("searchx.failed")}</span> : null}
              </p>
              {groups.map((group) => {
                const brain = brainByNs.get(group.namespace);
                return (
                  <section key={group.namespace || "_"}>
                    <div className="mb-2 flex items-center gap-2">
                      {brain ? <BrainAvatar brain={brain} token={token} size={20} /> : null}
                      <h2 className="min-w-0 truncate text-sm font-medium text-foreground" dir="auto" style={{ unicodeBidi: "plaintext" }}>{brainName(group.namespace)}</h2>
                      <span className="font-grid-mono text-[12.5px] text-muted-foreground">{group.hits.length}</span>
                      {!route.ns && group.namespace ? (
                        <Button variant="ghost" size="xs" className="ms-auto text-muted-foreground" onClick={() => setScope(group.namespace)}>
                          {t("nav.scopeBrain")}
                        </Button>
                      ) : null}
                    </div>
                    <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-md border border-border/60 bg-pane-raised">
                      {group.hits.map((hit) => (
                        <li key={hit.id}>
                          <button
                            type="button"
                            onClick={() => openHit(hit)}
                            title={t("searchx.openNote")}
                            className="flex w-full items-start gap-3 px-3 py-3 text-start hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-3 text-sm text-foreground/85" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                                {hit.content}
                              </span>
                              <span className="grid-micro mt-1 block text-muted-foreground">{hitMeta(hit)}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Browse({ recent, onRecent, onRemoveRecent, onClearRecent, brains, token, scopeNs, onScope }: {
  recent: string[];
  onRecent: (q: string) => void;
  onRemoveRecent: (q: string) => void;
  onClearRecent: () => void;
  brains: Brain[] | null;
  token: string;
  scopeNs?: string;
  onScope: (ns: string) => void;
}) {
  const { t, isRtl } = useI18n();
  return (
    <div className="flex flex-col gap-8 pt-2">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="grid-micro text-muted-foreground">{t("nav.recent")}</h2>
          {recent.length ? (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onClearRecent}>
              {t("nav.clearRecent")}
            </Button>
          ) : null}
        </div>
        {recent.length ? (
          <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-md border border-border/60 bg-pane-raised">
            {recent.map((q) => (
              <li key={q} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => onRecent(q)}
                  title={t("nav.rerun")}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-start text-sm hover:bg-hover"
                >
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                    {q}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t("searchx.removeRecent")}
                  title={t("searchx.removeRecent")}
                  onClick={() => onRemoveRecent(q)}
                  className="me-2 rounded-sm p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("searchx.noRecent")}</p>
        )}
      </section>

      <section>
        <h2 className="grid-micro mb-1 text-muted-foreground">{t("searchx.browse")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t("searchx.browseHint")}</p>
        {!brains ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : brains.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("brains.empty")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {brains.map((b) => {
              const active = b.namespace === scopeNs;
              return (
                <button
                  key={b.namespace}
                  type="button"
                  onClick={() => onScope(b.namespace)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-3 rounded-md border bg-pane-raised p-3 text-start transition-colors hover:bg-hover",
                    active ? "border-grid-gold/70 bg-grid-gold/10" : "border-border/60",
                  )}
                >
                  <BrainAvatar brain={b} token={token} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{b.displayName || b.namespace}</span>
                    <span className="block truncate font-grid-mono text-[12.5px] text-muted-foreground">
                      {t("searchx.memories", { count: b.memories })}
                    </span>
                  </span>
                  <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground", isRtl && "rotate-180")} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
