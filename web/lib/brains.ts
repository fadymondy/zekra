"use client"

// Data hooks for the brains hub, the brain overview, activity and gaps. Every key starts with
// /api/brain/ so the shared realtime stream (lib/realtime.tsx) revalidates them on each event.
import { useMemo } from "react"
import useSWR from "swr"

import { brainApi, type ActivityItem, type Gap, type GapStatus, type GraphData, type Memory, type Stats } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

export function useStats() {
  return useSWR<Stats>("/api/brain/stats", () => brainApi.stats(), { ...noRetryOn4xx, refreshInterval: 15_000 })
}

/** The activity log (all brains the caller can see), polled as a fallback to the live stream. */
export function useActivity(limit = 200) {
  return useSWR<ActivityItem[]>(
    ["/api/brain/activity", limit],
    () => brainApi.activity(limit).then((r) => r.items ?? []),
    { ...noRetryOn4xx, refreshInterval: 8_000 },
  )
}

/** One brain's operations, newest first. */
export function useBrainActivity(namespace: string, limit = 200) {
  const q = useActivity(limit)
  const rows = useMemo(() => (q.data ?? []).filter((i) => i.namespace === namespace), [q.data, namespace])
  return { ...q, rows }
}

export function useGraph(namespace: string, limit = 3000) {
  return useSWR<GraphData>(["/api/brain/graph", namespace, limit], () => brainApi.graph(namespace, limit), {
    ...noRetryOn4xx,
    // The graph is heavy; the live stream would redraw it on every retain. Revalidate on demand only.
    revalidateOnMount: true,
    revalidateIfStale: false,
  })
}

export function useSecretCount(namespace: string) {
  return useSWR<number>(
    ["/api/brain/secrets", namespace],
    () => brainApi.secrets(namespace).then((r) => r.secrets?.length ?? 0),
    noRetryOn4xx,
  )
}

export function useMemory(namespace: string, id: string | null) {
  return useSWR<Memory>(id && namespace ? ["/api/brain/memory", namespace, id] : null, () => brainApi.getMemory(namespace, id!), noRetryOn4xx)
}

/** Knowledge gaps for a brain. With no status it unions open, indexed and dismissed (the API's
 *  default leaves dismissed out). */
export function useGaps(namespace: string, status: "" | GapStatus) {
  return useSWR<Gap[]>(
    ["/api/brain/gaps", namespace, status],
    async () => {
      if (status) return (await brainApi.gaps({ namespace, status, limit: 200 })).gaps ?? []
      const all = await Promise.all(
        (["open", "indexed", "dismissed"] as const).map((s) => brainApi.gaps({ namespace, status: s, limit: 200 })),
      )
      return all.flatMap((r) => r.gaps ?? [])
    },
    { ...noRetryOn4xx, refreshInterval: 15_000 },
  )
}

/** A namespace slug from a free-form name, as the legacy "New brain" dialog made it. */
export function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export type Tone = "ok" | "warn" | "danger" | "muted" | "active"

const OUTCOME_TONE: Record<string, Tone> = { hit: "ok", empty: "warn", error: "danger", running: "active" }
export const toneFor = (outcome: string): Tone => OUTCOME_TONE[outcome] ?? "muted"
