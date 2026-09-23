import { useCallback, useEffect, useState } from "react";

import { getStored, removeStored, setStored } from "@/lib/storage";

import { parseRecent, pushRecent } from "./search-core";

// The last few searches (MH-360), persisted on the device. Kept in a module
// cache too, so switching tabs doesn't re-read storage or flash empty.

const KEY = "zekra.search.recent.v1";
let cache: string[] | null = null;
const listeners = new Set<(list: string[]) => void>();

function publish(list: string[]) {
  cache = list;
  for (const listener of listeners) listener(list);
}

export function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>(cache ?? []);

  useEffect(() => {
    listeners.add(setRecent);
    if (cache === null) {
      void getStored(KEY).then((raw) => {
        if (cache === null) publish(parseRecent(raw));
      });
    }
    return () => {
      listeners.delete(setRecent);
    };
  }, []);

  const add = useCallback((query: string) => {
    const next = pushRecent(cache ?? [], query);
    publish(next);
    void setStored(KEY, JSON.stringify(next));
  }, []);

  const clear = useCallback(() => {
    publish([]);
    void removeStored(KEY);
  }, []);

  return { recent, add, clear };
}
