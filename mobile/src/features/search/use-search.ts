import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { zekraApi, type Recalled } from "@/lib/api";
import { useAuth } from "@/providers/auth";

import { normalizeQuery, SEARCH_LIMIT } from "./search-core";

/**
 * Semantic search (POST /api/brain/search — the hybrid vector + BM25 recall
 * engine) as a query keyed on (query, namespace), so both search screens get
 * caching, de-duplication and stale-response ordering for free. An empty query
 * never fetches.
 *
 * `live` keeps the previous hits on screen while the next keystroke's answer
 * is in flight, so as-you-type results don't flash to a skeleton.
 */
export function useSemanticSearch(query: string, namespace?: string, opts: { live?: boolean } = {}) {
  const { token } = useAuth();
  const q = normalizeQuery(query);
  const result = useQuery({
    queryKey: ["search", q, namespace ?? "*"],
    queryFn: () => zekraApi.search(token!, q, namespace ? [namespace] : undefined, SEARCH_LIMIT),
    enabled: !!token && q.length > 0,
    staleTime: 30_000,
    placeholderData: opts.live ? keepPreviousData : undefined,
  });
  const results: Recalled[] = useMemo(() => result.data?.results ?? [], [result.data]);
  return {
    query: q,
    results,
    /** First answer for this question is on its way (nothing to show yet). */
    loading: q.length > 0 && result.isLoading,
    /** Any request in flight, including a live refresh over old hits. */
    fetching: result.isFetching,
    error: q.length > 0 ? (result.error as (Error & { status?: number }) | null) : null,
    /** An answer (possibly empty) exists for the current or previous question. */
    answered: q.length > 0 && result.data !== undefined,
    refetch: result.refetch,
  };
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
