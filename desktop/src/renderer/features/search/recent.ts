import { useCallback, useState } from "react";

import { normalizeQuery, parseRecent, pushRecent } from "@mobile/features/search/search-core";

/*
Recent searches, per account, in the renderer's localStorage (Electron
userData). List operations are mobile's (search-core: normalised, de-duplicated
case-insensitively, newest first, capped).
*/
const key = (userId: string) => `zekra.search.recent.${userId}`;

function load(userId: string): string[] {
  try {
    return parseRecent(localStorage.getItem(key(userId)));
  } catch {
    return [];
  }
}

function store(userId: string, list: string[]) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(list));
  } catch {
    // best effort
  }
}

export function useRecentSearches(userId: string) {
  const [list, setList] = useState<string[]>(() => load(userId));

  const update = useCallback(
    (fn: (prev: string[]) => string[]) => {
      setList((prev) => {
        const next = fn(prev);
        store(userId, next);
        return next;
      });
    },
    [userId],
  );

  return {
    list,
    push: useCallback((q: string) => update((prev) => pushRecent(prev, q)), [update]),
    remove: useCallback(
      (q: string) => update((prev) => prev.filter((x) => x.toLocaleLowerCase() !== normalizeQuery(q).toLocaleLowerCase())),
      [update],
    ),
    clear: useCallback(() => update(() => []), [update]),
  };
}
