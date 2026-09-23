// Pure logic for the Mahaam SDK integration (feedback reporter + error monitor):
// ring buffers, redaction, the feedback intake's form fields, and the monitor's
// envelope. No React Native imports, so `npm test` (node --test) runs it as-is.
//
// Wire contracts (read from the Mahaam server, not guessed):
//   Feedback — POST {intake} multipart/form-data, fields exactly the ones
//     internal/reports/embed.go reads: public_key, title, body, issue_type
//     (bug|feature|task), priority, page_url, route, selector, console_log,
//     network_log, user_agent, viewport, screenshot (PNG/JPEG/WebP, <= 8 MB).
//     201 {"key":"MG-12"}. The key travels in the BODY (`public_key`); an
//     X-Mahaam-Key header is ignored by the server. There is no reporter-email,
//     locale or meta column on this intake, so those go into `body`.
//   Monitor — POST {scheme}://{host}/api/monitor/{project}/envelope, JSON,
//     docs/mobile-sdk-contract.md in the Mahaam repo.

// ─── Ring buffers ─────────────────────────────────────────────────────────────

export type Ring<T> = { push(entry: T): void; items(): T[]; clear(): void; readonly size: number };

/** A bounded FIFO: once full, the oldest entry is dropped. */
export function createRing<T>(capacity: number): Ring<T> {
  const cap = Math.max(1, Math.floor(capacity));
  const buf: T[] = [];
  return {
    push(entry) {
      buf.push(entry);
      if (buf.length > cap) buf.splice(0, buf.length - cap);
    },
    items: () => buf.slice(),
    clear() {
      buf.length = 0;
    },
    get size() {
      return buf.length;
    },
  };
}

export type ConsoleEntry = { level: "log" | "info" | "warn" | "error" | "debug"; message: string; at: string };
export type NetworkEntry = { method: string; url: string; status: number | null; ms: number; at: string; error?: string };

// ─── Redaction ────────────────────────────────────────────────────────────────

/**
 * Removes what must never leave the phone in a report: bearer tokens, JWTs,
 * `token=`/`password:`-style values, the query string and fragment of any URL
 * (one-time links carry secrets there). Applied to every console line, crumb and
 * network URL before it is buffered, so nothing unredacted is ever held.
 */
export function redact(text: string): string {
  return text
    .replace(/((?:https?|zekra|exp\+?[a-z-]*):\/\/[^\s?#"')]+)[?#][^\s"')]*/gi, "$1")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/(["']?\b(?:access_token|refresh_token|id_token|token|password|passwd|secret|authorization|csrf_token|api_key|apikey|verifier)\b["']?\s*[:=]\s*)(["'])?[^\s"',}&)]+\2?/gi, "$1[redacted]");
}

/** One console argument as text, capped (errors get room for their stack). Same shape as the web SDK. */
export function formatArg(value: unknown, max = 400): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`.slice(0, max * 2);
  try {
    return JSON.stringify(value)?.slice(0, max) ?? String(value);
  } catch {
    return String(value).slice(0, max);
  }
}

/** A path for the network log: no query, no fragment, capped. */
export function safePath(path: string): string {
  return String(path).split(/[?#]/)[0].slice(0, 300);
}

/** The recorded console, newest last — byte-for-byte the web SDK's console_log format. */
export function consoleSnapshot(entries: readonly ConsoleEntry[], limit = 50): string {
  return entries
    .slice(-limit)
    .map((e) => `[${e.at}] ${e.level.toUpperCase()} ${e.message}`)
    .join("\n");
}

/** The recorded network activity, newest last — the web SDK's network_log format. */
export function networkSnapshot(entries: readonly NetworkEntry[], limit = 50): string {
  return entries
    .slice(-limit)
    .map((e) => `[${e.at}] ${e.method} ${e.url} → ${e.error ? `FAILED (${e.error})` : e.status} ${e.ms}ms`)
    .join("\n");
}

export function failedCount(entries: readonly NetworkEntry[]): number {
  return entries.filter((e) => e.error || (e.status ?? 0) >= 400).length;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export type FeedbackKind = "bug" | "idea" | "question";

/** The intake knows bug | feature | task (anything else is filed as a bug). */
export function issueTypeFor(kind: FeedbackKind): "bug" | "feature" | "task" {
  return kind === "idea" ? "feature" : kind === "question" ? "task" : "bug";
}

export type DeviceInfo = {
  appVersion: string;
  build: string;
  platform: string; // ios | android | web
  osVersion: string;
  model: string;
  locale: string;
  viewport: string; // "393x852@3"
};

export type ReportedError = { message: string; stack?: string };

export type FeedbackDraft = {
  kind: FeedbackKind;
  title: string;
  description: string;
  /** Optional reply-to address the reporter chose to leave. */
  email?: string;
  /** Route PATTERN ("/note/[id]"), never a real id. */
  route: string;
  error?: ReportedError;
};

export const TITLE_MAX = 200;
export const MAX_SCREENSHOT_BYTES = 8 << 20;
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export function screenshotTypeOk(mime: string | undefined | null): boolean {
  return !!mime && (SCREENSHOT_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/** `https://app.zekra.dev` + route. The server checks this URL's origin against the key's allowlist
 *  when a request carries no Origin header (every native request) — see embed.go. */
export function pageUrl(appUrl: string, route: string): string {
  const base = appUrl.replace(/\/+$/, "");
  const path = safePath(route || "/");
  return base + (path.startsWith("/") ? path : `/${path}`);
}

export function userAgent(d: DeviceInfo): string {
  return `ZekraMobile/${d.appVersion} (${d.build}; ${d.platform} ${d.osVersion}; ${d.model}; ${d.locale})`;
}

export function crashTitle(error: ReportedError): string {
  const first = (error.message || "Render error").split("\n")[0].trim();
  return `Crash: ${first}`.slice(0, TITLE_MAX);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** The issue body: what the reporter wrote, then the context the intake has no column for. */
export function composeBody(draft: FeedbackDraft, device: DeviceInfo | null, crumbs: readonly string[] = []): string {
  const parts: string[] = [];
  const desc = draft.description.trim();
  if (desc) parts.push(desc);
  if (draft.error) {
    const stack = draft.error.stack ? `\n\n\`\`\`\n${clip(redact(draft.error.stack), 8000)}\n\`\`\`` : "";
    parts.push(`**Error**\n${clip(redact(draft.error.message), 1000)}${stack}`);
  }
  const lines: string[] = [];
  const email = draft.email?.trim();
  if (email) lines.push(`- Contact: ${email}`);
  lines.push(`- Source: Zekra mobile app (${draft.kind})`);
  if (device) {
    lines.push(`- App: ${device.appVersion} (${device.build})`);
    lines.push(`- Device: ${device.model} · ${device.platform} ${device.osVersion}`);
    lines.push(`- Locale: ${device.locale}`);
  }
  lines.push(`- Screen: ${safePath(draft.route || "/")}`);
  parts.push(`**Reporter context**\n${lines.join("\n")}`);
  if (crumbs.length) parts.push(`**Recent steps**\n${crumbs.slice(-20).map((c) => `- ${c}`).join("\n")}`);
  return clip(parts.join("\n\n"), 20000);
}

export type FeedbackFieldsInput = {
  key: string;
  appUrl: string;
  draft: FeedbackDraft;
  /** null when the reporter turned diagnostics off. */
  device: DeviceInfo | null;
  crumbs?: readonly string[];
  consoleLog?: string;
  networkLog?: string;
};

/**
 * The multipart text fields, in order. The screenshot (a file part) is added by
 * the client. Empty values are left out, exactly like the web SDK's submit().
 */
export function buildFeedbackFields(input: FeedbackFieldsInput): [string, string][] {
  const { draft, device } = input;
  const title = (draft.title.trim() || (draft.error ? crashTitle(draft.error) : "")).slice(0, TITLE_MAX);
  const fields: [string, string][] = [
    ["public_key", input.key],
    ["title", title],
    ["body", composeBody(draft, device, device ? input.crumbs : [])],
    ["issue_type", issueTypeFor(draft.kind)],
    ["priority", draft.error ? "high" : ""],
    ["page_url", pageUrl(input.appUrl, draft.route)],
    ["route", safePath(draft.route || "/")],
    ["user_agent", device ? userAgent(device) : "ZekraMobile"],
    ["viewport", device?.viewport ?? ""],
    ["console_log", device ? clip(input.consoleLog ?? "", 50000) : ""],
    ["network_log", device ? clip(input.networkLog ?? "", 50000) : ""],
  ];
  return fields.filter(([, v]) => v !== "");
}

export type SubmitOutcome =
  | { ok: true; key?: string }
  | { ok: false; reason: "unavailable" | "invalid" | "rate" | "failed"; message?: string };

/** What the intake's answer means for the reporter. 402/403 = reporting is off for this key/plan. */
export function classifyResponse(status: number, body: unknown): SubmitOutcome {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) return { ok: true, key: typeof obj.key === "string" ? obj.key : undefined };
  const message = typeof obj.error === "string" ? obj.error : undefined;
  if (status === 402 || status === 403) return { ok: false, reason: "unavailable", message };
  if (status === 400 || status === 413 || status === 422) return { ok: false, reason: "invalid", message };
  if (status === 429) return { ok: false, reason: "rate", message };
  return { ok: false, reason: "failed", message };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validEmail(s: string): boolean {
  return EMAIL.test(s.trim());
}

// ─── Monitor (DSN) ────────────────────────────────────────────────────────────

export type Dsn = { publicKey: string; projectId: string; url: string };

/** https://<mdsn_key>@<host>/monitor/<project> → ingest URL. Malformed or empty → null (client off, never a throw). */
export function parseDsn(dsn: string | undefined | null): Dsn | null {
  const m = /^(https?):\/\/([^@\s/]+)@([^/\s]+)\/(?:.*\/)?(?:monitor\/)?([^/\s]+)\/?$/.exec(String(dsn ?? "").trim());
  if (!m) return null;
  const [, scheme, publicKey, host, projectId] = m;
  if (!publicKey || !projectId || projectId === "monitor") return null;
  return { publicKey, projectId, url: `${scheme}://${host}/api/monitor/${encodeURIComponent(projectId)}/envelope` };
}

export type MonitorLevel = "fatal" | "error" | "warning" | "info" | "debug";

export type MonitorEnvelope = {
  public_key: string;
  level: MonitorLevel;
  message?: string;
  exception_type?: string;
  exception_value?: string;
  stacktrace?: string;
  environment: string;
  release: string;
  server_name: string;
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
};

/**
 * The frames of a JS stack, most recent first, with nothing that varies between
 * occurrences of the same fault: the "Name: message" header line is dropped (the
 * server groups by the FIRST line), install paths are reduced to the file name
 * (iOS bundle paths carry a per-install UUID) and hex addresses are masked.
 */
export function stableStack(stack: string | undefined): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && (l.startsWith("at ") || /@|:\d+:\d+/.test(l)))
    .map((l) =>
      l
        .replace(/(?:file:\/\/)?(?:\/[^\s/():]+)+\/([^\s/():]+:\d+(?::\d+)?)/g, "$1")
        .replace(/0x[0-9a-f]{4,}/gi, "0x?"),
    )
    .slice(0, 60)
    .join("\n");
}

export function buildEnvelope(
  publicKey: string,
  error: unknown,
  ctx: { level: MonitorLevel; environment: string; /** blank → the app version */ release?: string; device: DeviceInfo; context?: string; network?: string },
): MonitorEnvelope {
  const d = ctx.device;
  const tags: Record<string, string> = {
    os: d.platform,
    os_version: d.osVersion,
    app_version: `${d.appVersion} (${d.build})`,
    device: d.model,
  };
  if (ctx.network) tags.network = ctx.network;
  if (ctx.context) tags.context = redact(ctx.context).slice(0, 60);
  const base = { public_key: publicKey, level: ctx.level, environment: ctx.environment, release: ctx.release || d.appVersion, server_name: d.model, tags };
  if (error instanceof Error) {
    return {
      ...base,
      exception_type: error.name || "Error",
      exception_value: redact(error.message).slice(0, 1000),
      stacktrace: stableStack(error.stack),
    };
  }
  return { ...base, message: redact(formatArg(error, 1000)) };
}

/** What to do with a queued envelope after a send attempt (docs/mobile-sdk-contract.md "Errors"). */
export function monitorOutcome(status: number | null): "sent" | "disable" | "retry" | "drop" {
  if (status === null) return "retry";
  if (status === 200 || status === 201) return "sent"; // 200 = bumped an existing issue
  if (status === 403) return "disable";
  if (status === 429 || status >= 500) return "retry";
  return "drop"; // 400 malformed: retrying the same bytes cannot help
}

/** Caps a persisted queue, dropping the oldest first. */
export function capQueue<T>(queue: readonly T[], max: number): T[] {
  return queue.length > max ? queue.slice(queue.length - max) : queue.slice();
}

// ─── Shake to report ──────────────────────────────────────────────────────────

export type Accel = { x: number; y: number; z: number };

export type ShakeConfig = {
  /** Total acceleration, in g (gravity included, so at rest it reads ~1). */
  threshold: number;
  /** Strong jolts needed inside `windowMs` — one bump or a dropped phone is not a shake. */
  hits: number;
  windowMs: number;
  /** Samples closer than this are the same jolt. */
  minGapMs: number;
  /** After a shake fires, ignore everything for this long. */
  cooldownMs: number;
};

export const SHAKE: ShakeConfig = { threshold: 2.2, hits: 3, windowMs: 1000, minGapMs: 100, cooldownMs: 3000 };

export function gForce(a: Accel): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

/** Feed it accelerometer samples (in g) with a timestamp in ms; it answers true once per deliberate shake. */
export function createShakeDetector(cfg: ShakeConfig = SHAKE): (sample: Accel, t: number) => boolean {
  let hits: number[] = [];
  let lastFire = Number.NEGATIVE_INFINITY;
  return (sample, t) => {
    if (t - lastFire < cfg.cooldownMs) return false;
    if (!(gForce(sample) >= cfg.threshold)) return false;
    if (hits.length && t - hits[hits.length - 1] < cfg.minGapMs) return false;
    hits = hits.filter((h) => t - h <= cfg.windowMs);
    hits.push(t);
    if (hits.length < cfg.hits) return false;
    hits = [];
    lastFire = t;
    return true;
  };
}

/**
 * The size to pass react-native-view-shot so the capture's long side is at most
 * `maxLong` pixels, or null when the screen already fits. The units differ by
 * platform: iOS renders `width`×`height` POINTS at the screen scale; Android
 * scales the bitmap to `width`×`height` PIXELS.
 */
export function captureSize(platform: string, width: number, height: number, scale: number, maxLong = 1600): { width: number; height: number } | null {
  const longPx = Math.max(width, height) * scale;
  if (!(longPx > maxLong) || width <= 0 || height <= 0 || scale <= 0) return null;
  const f = maxLong / longPx;
  return platform === "ios"
    ? { width: Math.floor(width * f * 1000) / 1000, height: Math.floor(height * f * 1000) / 1000 }
    : { width: Math.floor(width * scale * f), height: Math.floor(height * scale * f) };
}

/** Screens a capture must never be taken of: sign-in, passwords, connection keys — or any screen showing a revealed secret. */
const NO_CAPTURE = [/^\/sign-in/, /^\/auth(\/|$)/, /^\/account\/(password|delete)/, /^\/settings\/connect/];

export function autoCaptureAllowed(route: string, sensitiveOnScreen: boolean): boolean {
  if (sensitiveOnScreen) return false;
  const path = safePath(route || "/");
  return !NO_CAPTURE.some((re) => re.test(path));
}
