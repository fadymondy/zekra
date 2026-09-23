// Signals between the push module and the notification center (MH-360).
//
// The push module (src/features/push) has no react-query client and the
// notification center has no FCM listeners, so they meet here:
//   - "received": a push arrived (or a tapped one was just marked read) —
//     the inbox and the badge refetch;
//   - "opened":   the foreground banner of notification `id` was tapped — the
//     push watcher (which holds the session) marks it read.

export type NotifySignal = { type: "received" } | { type: "opened"; id: string };

type Listener = (signal: NotifySignal) => void;

const listeners = new Set<Listener>();

export function emitNotify(signal: NotifySignal): void {
  listeners.forEach((l) => {
    try {
      l(signal);
    } catch {}
  });
}

export function onNotify(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
