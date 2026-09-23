// Formatting for the update loader (renderer) — pure, shared so the unit
// tests (compiled by the main tsc project) cover it too.

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** 1536 -> "1.5 KB"; 0/undefined -> "". Decimal (Finder-style) units. */
export function formatBytes(n: number | undefined | null): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "";
  let v = n;
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toFixed(digits)} ${UNITS[i]}`;
}

/** "12.3 MB of 98.1 MB" (or just the total / transferred when one is unknown). */
export function formatTransfer(transferred?: number, total?: number): string {
  const t = formatBytes(transferred);
  const all = formatBytes(total);
  if (t && all) return `${t} / ${all}`;
  return all || t;
}

export function formatSpeed(bytesPerSecond?: number): string {
  const b = formatBytes(bytesPerSecond);
  return b ? `${b}/s` : "";
}

/** Seconds left at the current speed, or null when unknown. */
export function etaSeconds(transferred?: number, total?: number, bytesPerSecond?: number): number | null {
  if (!total || !bytesPerSecond || bytesPerSecond <= 0 || transferred === undefined) return null;
  const left = Math.max(0, total - transferred);
  return Math.ceil(left / bytesPerSecond);
}

/** Clamp a percentage for rings and bars. */
export function clampPercent(p: number | undefined): number {
  if (p === undefined || !Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p));
}
