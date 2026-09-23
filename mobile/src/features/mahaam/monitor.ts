import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { MAHAAM_DSN } from "./config";
import { deviceInfo, onUncaught } from "./diagnostics";
import { buildEnvelope, capQueue, monitorOutcome, parseDsn, type MonitorEnvelope, type MonitorLevel } from "./mahaam-core";

// Mahaam error monitoring (the DSN-based "Mahaam SDK"), following the Mahaam
// repo's docs/mobile-sdk-contract.md + docs/mobile-crash-capture.md. The
// published @mahaam/react-native package does not exist on npm, so this is the
// contract implemented directly (~100 lines): it runs ALONGSIDE Crashlytics,
// which keeps native crashes and ANRs — no signal handlers here.
//
//   - Off unless EXPO_PUBLIC_MAHAAM_DSN is set and parses; never throws.
//   - Persist first, send after: every envelope is written to a capped file
//     queue synchronously, so a fatal JS error survives the process dying, and
//     the queue is flushed on next launch (never blocking start).
//   - 201/200 → sent · 403 → stop for this run (bad/revoked DSN) · 429/5xx/offline
//     → keep and retry later · anything else → drop.
//   - Same privacy rule as crash.ts: no user id, email, note text or query strings
//     (buildEnvelope redacts messages; stacks carry file:line only).

const dsn = parseDsn(MAHAAM_DSN);
let disabled = !dsn || Platform.OS === "web";
let flushing = false;
let seq = 0;

const QUEUE_MAX = 200;
const SEND_BATCH = 10; // the ingest allows 60/min per IP — never replay a backlog at once

type Queued = { id: string; env: MonitorEnvelope };

const queueFile = () => new File(Paths.document, "mahaam-monitor-queue.v1.json");

function readQueue(): Queued[] {
  try {
    const f = queueFile();
    if (!f.exists) return [];
    const parsed = JSON.parse(f.textSync()) as unknown;
    return Array.isArray(parsed) ? (parsed as Queued[]).filter((q) => q && typeof q.id === "string" && q.env) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: Queued[]): void {
  try {
    const f = queueFile();
    if (!queue.length) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create({ intermediates: true });
    f.write(JSON.stringify(capQueue(queue, QUEUE_MAX)));
  } catch {}
}

export function monitorEnabled(): boolean {
  return !disabled;
}

/** Queue one error for the Mahaam board. `fatal` = the app is going down: persist only, send next launch. */
export function captureError(error: unknown, level: MonitorLevel = "error", context?: string): void {
  if (disabled || !dsn) return;
  try {
    const env = buildEnvelope(dsn.publicKey, error, {
      level,
      environment: __DEV__ ? "development" : "production",
      device: deviceInfo(),
      context,
    });
    writeQueue([...readQueue(), { id: `${Date.now().toString(36)}-${++seq}`, env }]);
    if (level !== "fatal") void flushMonitor();
  } catch {}
}

/** Sends what is queued (at most SEND_BATCH per call). Safe to call any time; never throws. */
export async function flushMonitor(): Promise<void> {
  if (disabled || !dsn || flushing) return;
  flushing = true;
  const done = new Set<string>();
  try {
    for (const item of readQueue().slice(0, SEND_BATCH)) {
      let status: number | null = null;
      try {
        const res = await fetch(dsn.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(item.env),
        });
        status = res.status;
      } catch {
        status = null;
      }
      const outcome = monitorOutcome(status);
      if (outcome === "sent" || outcome === "drop") done.add(item.id);
      else if (outcome === "disable") {
        disabled = true;
        writeQueue([]);
        return;
      } else break; // retry later, keep order
    }
    // Re-read: captureError may have appended while we were sending.
    if (done.size) writeQueue(readQueue().filter((q) => !done.has(q.id)));
  } finally {
    flushing = false;
  }
}

let started = false;

/** Called once from initCrashReporting(): hooks uncaught errors and flushes last run's queue. */
export function initMonitor(): void {
  if (started || disabled) return;
  started = true;
  onUncaught((error, isFatal) => captureError(error, isFatal ? "fatal" : "error", "uncaught"));
  setTimeout(() => void flushMonitor(), 3000);
}
