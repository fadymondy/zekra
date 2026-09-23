import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo } from "react";

import { exportFileName, mergeBrains, type BrainDetail, type BrainListItem, type BrainStats } from "@/features/brains/brains-core";
import { API_URL, request } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";

// Brains-home data (MH-365): the same endpoints the web console's brains page
// reads (web/lib/api.ts brainApi).

const enc = encodeURIComponent;

export const brainKeys = {
  stats: (token: string | null) => ["brain-stats", token] as const,
  namespaces: (token: string | null) => ["brain-namespaces", token] as const,
  detail: (token: string | null, ns: string) => ["brain-detail", token, ns] as const,
};

export const brainsApi = {
  stats: (token: string) => request<BrainStats>("/api/brain/stats", { token }),
  namespaces: (token: string) => request<{ brains?: BrainListItem[] }>("/api/brain/namespaces", { token }),
  detail: (token: string, namespace: string) => request<BrainDetail>(`/api/brain/brain?namespace=${enc(namespace)}`, { token }),
  create: (token: string, body: { namespace: string; displayName?: string; color?: string; description?: string; icon?: string }) =>
    request<{ namespace: string; role: string }>("/api/brain/brains", { token, json: body }),
  retain: (token: string, body: { namespace: string; content: string; sourceKind: string; sourceRef: string }) =>
    request<unknown>("/api/brain/retain", { token, json: body }),
  remove: (token: string, namespace: string) =>
    request<{ deleted?: number }>("/api/brain/brain/delete", { token, json: { namespace, confirm: namespace } }),
};

/** Fleet stats, polled every 15s while the Brains tab is focused. */
export function useBrainStats() {
  const { token } = useAuth();
  const focused = useIsFocused();
  return useQuery({
    queryKey: brainKeys.stats(token),
    queryFn: () => brainsApi.stats(token!),
    enabled: !!token,
    refetchInterval: focused ? 15_000 : false,
    staleTime: 10_000,
  });
}

/** Membership (/mine, via the BrainProvider) merged with /namespaces (lastAt
 *  and the profile summary). The list still shows if /namespaces fails. */
export function useBrainList() {
  const { token } = useAuth();
  const { brains, loading, error, refresh } = useBrains();
  const ns = useQuery({
    queryKey: brainKeys.namespaces(token),
    queryFn: () => brainsApi.namespaces(token!),
    enabled: !!token,
    staleTime: 30_000,
  });
  const merged = useMemo(() => mergeBrains(brains as BrainListItem[], ns.data?.brains), [brains, ns.data]);
  const refetch = useCallback(() => Promise.all([refresh(), ns.refetch()]), [refresh, ns]);
  return { brains: merged, loading, error, refetch };
}

/** Per-brain detail (recalls, types, gaps), fetched when a card mounts. */
export function useBrainDetail(namespace: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: brainKeys.detail(token, namespace),
    queryFn: () => brainsApi.detail(token!, namespace),
    enabled: !!token && !!namespace,
    staleTime: 60_000,
  });
}

/** Refresh everything the Brains home shows (after create/delete). */
export function useInvalidateBrains() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["brains"] }),
        client.invalidateQueries({ queryKey: ["brain-namespaces"] }),
        client.invalidateQueries({ queryKey: ["brain-stats"] }),
        client.invalidateQueries({ queryKey: ["brain-detail"] }),
      ]),
    [client],
  );
}

/**
 * Export a brain as NDJSON: download GET /api/brain/export with the bearer
 * into the cache directory, then hand the file to the share sheet (save to
 * Files, AirDrop, mail…).
 */
export async function exportBrain(token: string, namespace: string, dialogTitle: string): Promise<void> {
  const target = new File(Paths.cache, exportFileName(namespace, new Date()));
  const file = await File.downloadFileAsync(`${API_URL}/api/brain/export?namespace=${enc(namespace)}`, target, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-ndjson", "X-Agent-Id": "zekra-mobile" },
    idempotent: true,
  });
  if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
  await Sharing.shareAsync(file.uri, { mimeType: "application/x-ndjson", UTI: "public.plain-text", dialogTitle });
}
