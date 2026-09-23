import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  brainHex,
  exportFileName,
  mergeBrains,
  type BrainDetail,
  type BrainListItem,
  type BrainStats,
} from "@mobile/features/brains/brains-core";

import { request, type Brain } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useAuthed } from "../../shell/session";

/*
Brains-home data (MH-450): the endpoints the web console's brains page and the
mobile Brains tab read (mobile/src/features/brains/brain-data.ts), through the
desktop's proxied request(). SWR (from the web install) caches per key so the
cards' per-brain detail survives leaving and coming back.
*/

const enc = encodeURIComponent;

export const brainsApi = {
  stats: (token: string) => request<BrainStats>("/api/brain/stats", { token }),
  namespaces: (token: string) => request<{ brains?: BrainListItem[] }>("/api/brain/namespaces", { token }),
  detail: (token: string, ns: string) => request<BrainDetail>(`/api/brain/brain?namespace=${enc(ns)}`, { token }),
  create: (
    token: string,
    body: { namespace: string; displayName?: string; color?: string; description?: string; icon?: string },
  ) => request<{ namespace: string; role: string }>("/api/brain/brains", { token, json: body }),
  retain: (token: string, body: { namespace: string; content: string; sourceKind: string; sourceRef: string }) =>
    request<unknown>("/api/brain/retain", { token, json: body }),
  remove: (token: string, ns: string) =>
    request<{ deleted?: number }>("/api/brain/brain/delete", { token, json: { namespace: ns, confirm: ns } }),
};

/** Fleet stats, refreshed every 15s while the Brains home is mounted. */
export function useBrainStats() {
  const { token } = useAuthed();
  return useSWR(["brain-stats", token], () => brainsApi.stats(token), {
    refreshInterval: 15_000,
    dedupingInterval: 10_000,
  });
}

/** Membership (session brains = /mine) merged with /namespaces (lastAt,
 *  profile). The list still shows if /namespaces fails. */
export function useBrainList(): { brains: BrainListItem[] | null; refresh: () => Promise<void> } {
  const { token, brains, reloadBrains } = useAuthed();
  const ns = useSWR(["brain-namespaces", token], () => brainsApi.namespaces(token), { dedupingInterval: 30_000 });
  const merged = useMemo(
    () => (brains ? mergeBrains(brains as BrainListItem[], ns.data?.brains) : null),
    [brains, ns.data],
  );
  const { mutate } = ns;
  const refresh = useCallback(async () => {
    await Promise.all([reloadBrains(), mutate()]);
  }, [reloadBrains, mutate]);
  return { brains: merged, refresh };
}

/** Per-brain detail (recalls, entity types, open gaps), fetched per card. */
export function useBrainDetail(ns: string) {
  const { token } = useAuthed();
  return useSWR(ns ? ["brain-detail", token, ns] : null, () => brainsApi.detail(token, ns), {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  });
}

/** Invalidate everything the Brains home shows (after create/delete). */
export function useInvalidateBrains() {
  const { mutate } = useSWRConfig();
  const { reloadBrains } = useAuthed();
  return useCallback(async () => {
    await Promise.all([
      reloadBrains(),
      mutate((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("brain-")),
    ]);
  }, [mutate, reloadBrains]);
}

/**
 * Export a brain as NDJSON: GET /api/brain/export through the proxy, then the
 * native save dialog. Returns the saved path, or null when cancelled.
 */
export async function exportBrain(token: string, ns: string): Promise<string | null> {
  const text = await request<unknown>(`/api/brain/export?namespace=${enc(ns)}`, {
    token,
    headers: { Accept: "application/x-ndjson" },
  });
  // request() JSON-parses when it can; an NDJSON body with one line parses as
  // an object, several lines do not — normalise back to the raw text.
  const body = typeof text === "string" ? text : text === undefined ? "" : JSON.stringify(text) + "\n";
  const res = await bridge().saveFile({
    suggestedName: exportFileName(ns, new Date()),
    filters: [{ name: "JSON Lines", extensions: ["jsonl", "ndjson"] }],
    text: body,
  });
  return res.canceled ? null : (res.path ?? exportFileName(ns, new Date()));
}

/** A session Brain for a list item (the routes and avatar take Brain). */
export function asBrain(b: BrainListItem): Brain {
  return {
    namespace: b.namespace,
    role: b.role ?? "",
    canWrite: b.canWrite ?? false,
    memories: b.memories,
    displayName: b.displayName,
    description: b.description,
    colorHex: brainHex(b) || undefined,
    icon: b.icon,
    imageUrl: b.imageUrl,
  };
}
