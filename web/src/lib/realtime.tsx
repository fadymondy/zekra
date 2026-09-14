import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeBrainEvents, type BrainEventName } from "./brain";

type LiveStatus = "connecting" | "live" | "down";

const RealtimeContext = createContext<LiveStatus>("connecting");

/** Live-connection status for the "live" indicator. */
export function useLiveStatus(): LiveStatus {
  return useContext(RealtimeContext);
}

// Which TanStack query families to refetch for each SSE event. Keys are matched
// by prefix so every variant (e.g. ["brain","gaps","open"]) is invalidated.
const INVALIDATE: Record<BrainEventName, string[][]> = {
  retain: [["brain", "stats"], ["brain", "activity"], ["brain", "namespaces"], ["brain", "graph"]],
  recall: [["brain", "stats"], ["brain", "activity"]],
  search: [["brain", "stats"], ["brain", "activity"]],
  gap: [["brain", "gaps"], ["brain", "stats"]],
  grant: [["brain", "tokens"]],
  brain: [["brain", "namespaces"], ["brain", "stats"], ["brain", "graph"], ["brain", "detail"]],
  secret: [["brain", "secrets"]],
};

/**
 * Single shared EventSource for the whole console. On each brain event it
 * invalidates the relevant TanStack queries so every page live-updates across
 * users / MCP clients, and exposes connection status via useLiveStatus().
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  // Keep the latest client without re-subscribing the stream on every render.
  const qcRef = useRef(qc);
  qcRef.current = qc;

  useEffect(() => {
    const stop = subscribeBrainEvents({
      onOpen: () => setStatus("live"),
      onError: () => setStatus("down"),
      onEvent: (name) => {
        setStatus("live");
        for (const key of INVALIDATE[name] ?? []) {
          qcRef.current.invalidateQueries({ queryKey: key });
        }
      },
    });
    return stop;
  }, []);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}

/** Realtime status as the grid draws state: a square in the status fill beside a micro-label
 *  in its text-safe tone. No pulse — the grid's motion is colour-only. */
export function LiveIndicator() {
  const status = useLiveStatus();
  const map: Record<LiveStatus, { square: string; label: string; text: string }> = {
    live: { square: "bg-success", label: "Live", text: "text-tone-ok" },
    connecting: { square: "bg-warning", label: "Connecting", text: "text-tone-warn" },
    down: { square: "bg-muted-foreground", label: "Offline", text: "text-muted-foreground" },
  };
  const s = map[status];
  return (
    <span
      className="inline-flex items-center gap-2 border border-border px-2 py-1"
      title={`Realtime: ${s.label}`}
    >
      <span aria-hidden className={`size-2 shrink-0 ${s.square}`} />
      <span className={`font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] ${s.text}`}>{s.label}</span>
    </span>
  );
}
