"use client"

// One shared Server-Sent Events stream from the brain plugin (/api/brain/events) for the whole
// console. Every brain event revalidates the cached /api/brain/* responses, so each open view
// live-updates without its own subscription. Named events: retain · recall · search · gap ·
// grant · brain · secret.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useSWRConfig } from "swr"

export type LiveStatus = "connecting" | "live" | "down"
const EVENTS = ["retain", "recall", "search", "gap", "grant", "brain", "secret"] as const

const LiveContext = createContext<LiveStatus>("connecting")
export const useLiveStatus = () => useContext(LiveContext)

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { mutate } = useSWRConfig()
  const [status, setStatus] = useState<LiveStatus>("connecting")

  useEffect(() => {
    const es = new EventSource("/api/brain/events")
    let timer: ReturnType<typeof setTimeout> | null = null
    // Coalesce bursts (a sync ingests many memories) into one refetch.
    const refresh = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void mutate((key) => {
          const k = Array.isArray(key) ? key[0] : key
          return typeof k === "string" && k.startsWith("/api/brain/")
        })
      }, 400)
    }
    es.onopen = () => setStatus("live")
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? "down" : "connecting")
    for (const name of EVENTS) es.addEventListener(name, refresh)
    return () => {
      if (timer) clearTimeout(timer)
      es.close()
    }
  }, [mutate])

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>
}
