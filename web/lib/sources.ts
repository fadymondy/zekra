"use client"

import useSWR from "swr"

import { brainApi, type Datasource } from "@/lib/api"
import { noRetryOn4xx } from "@/lib/queries"

/** A brain's configured data sources. The key starts with /api/brain/ so realtime revalidates it;
 * it also polls while any source is syncing. */
export function useDatasources(namespace: string | null | undefined) {
  return useSWR<Datasource[]>(
    namespace ? ["/api/brain/datasources", namespace] : null,
    ([, ns]: [string, string]) => brainApi.datasources(ns).then((r) => r.datasources ?? []),
    {
      ...noRetryOn4xx,
      refreshInterval: (list) => (list?.some((s) => s.status === "syncing") ? 3_000 : 15_000),
    },
  )
}

/** Config values the API redacts on read ("••••"). */
export function isRedacted(v: unknown): boolean {
  return typeof v !== "string" || v === "" || /^[•*]+$/.test(v)
}
