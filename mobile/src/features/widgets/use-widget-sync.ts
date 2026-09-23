import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { brainKeys, brainsApi } from "@/features/brains/brain-data";
import type { BrainDetail, BrainListItem, BrainStats } from "@/features/brains/brains-core";
import { zekraApi, type Brain } from "@/lib/api";
import { firebaseReady } from "@/lib/crash";
import { rnfbMessaging } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";

import { syncWidgets } from "./sync";

// Keeps the home-screen widgets in step with the app (MH-360). Mount once at
// the root, inside the Query / Auth / I18n / Brain providers.
//
// It writes a snapshot whenever the app has fresh data — without owning any of
// it: it listens to the React Query cache for the Brains-home queries
// (["brains"] from BrainProvider, ["brain-namespaces"], ["brain-stats"],
// ["brain-detail"] from features/brains/brain-data.ts) and, on launch,
// foreground, sign-in/out, language change and incoming push, fetches them
// through the same cache (so the Brains screen benefits too).

const WATCHED = new Set<unknown>(["brains", "brain-namespaces", "brain-stats", "brain-detail"]);
const DEBOUNCE_MS = 600;
/** fetchQuery reuses cached data younger than this (launch / foreground). */
const FRESH_MS = 20_000;

export function useWidgetSync(): void {
  const client = useQueryClient();
  const { ready, token } = useAuth();
  const { locale } = useI18n();
  const { namespace } = useBrains();
  const latest = useRef({ ready, token, locale, namespace });
  latest.current = { ready, token, locale, namespace };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceNext = useRef(false);

  const syncFromCache = useCallback(() => {
    const { ready, token, locale, namespace } = latest.current;
    const force = forceNext.current;
    forceNext.current = false;
    if (!ready) return;
    if (!token) {
      void syncWidgets({ signedIn: false, locale }, { force });
      return;
    }
    const mine = client.getQueryData<{ brains: Brain[] }>(["brains", token])?.brains;
    if (!mine) return; // nothing to show yet; the fetch will call back
    void syncWidgets(
      {
        signedIn: true,
        locale,
        mine: mine as BrainListItem[],
        namespaces: client.getQueryData<{ brains?: BrainListItem[] }>(brainKeys.namespaces(token))?.brains,
        stats: client.getQueryData<BrainStats>(brainKeys.stats(token)) ?? null,
        pinnedNamespace: namespace || null,
        pinnedDetail: namespace ? client.getQueryData<BrainDetail>(brainKeys.detail(token, namespace)) ?? null : null,
      },
      { force },
    );
  }, [client]);

  const schedule = useCallback(
    (force = false) => {
      if (force) forceNext.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(syncFromCache, DEBOUNCE_MS);
    },
    [syncFromCache],
  );

  const refresh = useCallback(
    async (fresh: boolean) => {
      const { token, namespace } = latest.current;
      if (token) {
        const staleTime = fresh ? 0 : FRESH_MS;
        await Promise.allSettled([
          client.fetchQuery({ queryKey: ["brains", token], queryFn: () => zekraApi.brains(token), staleTime }),
          client.fetchQuery({ queryKey: brainKeys.namespaces(token), queryFn: () => brainsApi.namespaces(token), staleTime }),
          client.fetchQuery({ queryKey: brainKeys.stats(token), queryFn: () => brainsApi.stats(token), staleTime }),
          namespace
            ? client.fetchQuery({ queryKey: brainKeys.detail(token, namespace), queryFn: () => brainsApi.detail(token, namespace), staleTime })
            : Promise.resolve(null),
        ]);
      }
      schedule(fresh);
    },
    [client, schedule],
  );

  // Any successful fetch of the Brains-home data, by anyone.
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success" && WATCHED.has(event.query.queryKey[0])) schedule();
      }),
    [client, schedule],
  );

  // Launch, sign-in / sign-out, language change, a different pinned brain.
  useEffect(() => {
    if (ready) void refresh(false);
  }, [ready, token, locale, namespace, refresh]);

  // Foreground: refresh; background: flush a pending sync now.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh(false);
      else if (state === "background" && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        syncFromCache();
      }
    });
    return () => sub.remove();
  }, [refresh, syncFromCache]);

  // A push while the app is open usually means a brain changed: refetch.
  useEffect(() => {
    const mod = rnfbMessaging();
    if (!mod || !firebaseReady()) return;
    try {
      return mod.onMessage(mod.getMessaging(), async () => {
        void refresh(true);
      });
    } catch {
      return;
    }
  }, [refresh]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
