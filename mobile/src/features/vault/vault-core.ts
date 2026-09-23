// Pure vault logic (MH-370): no React Native imports, so `node --test` can
// exercise it directly. Mirrors the server rules in
// plugins/brain/internal/brain/secrets.go where noted.

/** The kinds the console offers when storing a secret (web KINDS list). */
export const SECRET_KINDS = [
  "generic",
  "api_key",
  "password",
  "token",
  "env",
  "private_key",
  "connection_string",
  "credential",
] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

export function isSecretKind(kind: string | undefined | null): kind is SecretKind {
  return !!kind && (SECRET_KINDS as readonly string[]).includes(kind);
}

/** Icon ids, resolved to lucide components in the RN layer. */
export type KindIcon = "shield" | "key-round" | "lock" | "ticket" | "terminal" | "file-key" | "database" | "badge-check";

const KIND_ICON: Record<SecretKind, KindIcon> = {
  generic: "shield",
  api_key: "key-round",
  password: "lock",
  token: "ticket",
  env: "terminal",
  private_key: "file-key",
  connection_string: "database",
  credential: "badge-check",
};

// Kinds the retain-path auto-capture writes (secretMatchers in secrets.go) that
// are not in the manual list. They get the icon of their closest manual kind;
// their label stays the raw kind string.
const CAPTURED_ICON: Record<string, KindIcon> = {
  aws_key: "key-round",
  openai_key: "key-round",
  pat: "ticket",
  jwt: "ticket",
  bearer: "ticket",
};

export function kindIcon(kind: string | undefined | null): KindIcon {
  const k = (kind || "generic").trim();
  if (isSecretKind(k)) return KIND_ICON[k];
  return CAPTURED_ICON[k] ?? "shield";
}

/** The dictionary key for a kind's label, or null for a kind the app does not
 *  translate (shown raw, LTR). An empty kind is "generic" (the server default). */
export function kindLabelKey(kind: string | undefined | null): `vault.kind.${SecretKind}` | null {
  const k = (kind || "generic").trim();
  return isSecretKind(k) ? `vault.kind.${k}` : null;
}

/** Kinds whose values are usually several lines (PEM blocks, .env dumps). */
export function isMultilineKind(kind: string): boolean {
  return kind === "private_key" || kind === "env";
}

// ─── Names ──────────────────────────────────────────────────────────────────

export const SECRET_NAME_MAX = 96;
const VALID_NAME = /^[A-Za-z0-9_.-]+$/;

/** Byte-for-byte mirror of sanitizeSecretName in secrets.go. */
export function sanitizeSecretName(raw: string): string {
  let s = raw.trim().replace(/[^A-Za-z0-9_.-]+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  if (s === "") s = "secret";
  if (s.length > SECRET_NAME_MAX) s = s.slice(0, SECRET_NAME_MAX);
  return s;
}

export type NameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: "empty" | "tooLong" | "invalid"; suggestion?: string };

/**
 * Client-side name check. The server silently sanitises names on store, but
 * reveal/delete look names up verbatim, and the store response echoes the raw
 * name — so a name the server would rewrite is rejected here with the
 * sanitised form offered instead, keeping the stored name what the user typed.
 */
export function validateSecretName(raw: string): NameCheck {
  const name = raw.trim();
  if (!name) return { ok: false, reason: "empty" };
  if (!VALID_NAME.test(name)) return { ok: false, reason: "invalid", suggestion: sanitizeSecretName(name) };
  if (name.length > SECRET_NAME_MAX) return { ok: false, reason: "tooLong", suggestion: name.slice(0, SECRET_NAME_MAX) };
  // Leading/trailing underscores are trimmed by the server.
  const clean = sanitizeSecretName(name);
  if (clean !== name) return { ok: false, reason: "invalid", suggestion: clean };
  return { ok: true, name };
}

// ─── Masking ────────────────────────────────────────────────────────────────

const MASK = "••••";

/** Mirror of maskHint in secrets.go: a non-reversible preview such as
 *  "sk-…mnop". Used to preview what the list will show for a new value. */
export function maskValue(value: string): string {
  const v = value.trim();
  // Go's len() counts bytes; code points are the closer match for display and
  // agree with the server for the ASCII values secrets almost always are.
  const chars = Array.from(v);
  if (chars.length <= 4) return MASK;
  let head = "";
  const i = v.search(/[-_]/);
  if (i > 0 && i <= 6) head = v.slice(0, i + 1);
  return `${head}…${chars.slice(-4).join("")}`;
}

/** What the row shows in place of the value. */
export function displayHint(hint: string | undefined | null): string {
  return hint && hint.trim() ? hint : MASK;
}

// ─── Time ───────────────────────────────────────────────────────────────────

export type Ago = { unit: "now" | "m" | "h" | "d" | "w" | "mo" | "y"; n: number };

/** A coarse "how long ago" for an RFC3339 timestamp; null if unparseable. */
export function relativeAgo(iso: string | undefined | null, now: number = Date.now()): Ago | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return { unit: "now", n: 0 };
  if (s < 3600) return { unit: "m", n: Math.floor(s / 60) };
  if (s < 86400) return { unit: "h", n: Math.floor(s / 3600) };
  if (s < 7 * 86400) return { unit: "d", n: Math.floor(s / 86400) };
  if (s < 30 * 86400) return { unit: "w", n: Math.floor(s / (7 * 86400)) };
  if (s < 365 * 86400) return { unit: "mo", n: Math.floor(s / (30 * 86400)) };
  return { unit: "y", n: Math.floor(s / (365 * 86400)) };
}

// ─── List ───────────────────────────────────────────────────────────────────

/** The filter field appears once the list is longer than this. */
export const FILTER_THRESHOLD = 5;

export function filterSecrets<T extends { name: string; kind?: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => s.name.toLowerCase().includes(q) || (s.kind ?? "").toLowerCase().includes(q));
}

// ─── Reveal policy ──────────────────────────────────────────────────────────

/** A revealed value is hidden again after this long. */
export const REVEAL_TTL_MS = 30_000;
/** A copied value is wiped from the clipboard after this long, if still there. */
export const CLIPBOARD_TTL_MS = 60_000;

/** 401/403 from reveal mean the caller lacks write access on the brain. */
export function isDeniedStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** expo-local-authentication's SecurityLevel.NONE. */
export const SECURITY_LEVEL_NONE = 0;

export type AuthOutcome = { success: true } | { success: false; error: string };
export type GateDecision = "proceed" | "cancel" | "failed";

/**
 * Turn a device-auth outcome into a decision.
 *
 * - `level` NONE (no passcode, no biometrics): there is nothing to confirm
 *   with, so the reveal proceeds; the server's write-access check is still the
 *   real gate. The same holds when the prompt reports the device has no usable
 *   authenticator (not_enrolled / not_available / passcode_not_set).
 * - Any cancel (user, system, app) aborts quietly.
 * - Anything else (lockout, failed, timeout, unknown) blocks the reveal.
 */
export function gateDecision(level: number, outcome: AuthOutcome | null): GateDecision {
  if (level === SECURITY_LEVEL_NONE || !outcome) return "proceed";
  if (outcome.success) return "proceed";
  switch (outcome.error) {
    case "not_enrolled":
    case "not_available":
    case "passcode_not_set":
      return "proceed";
    case "user_cancel":
    case "system_cancel":
    case "app_cancel":
    case "user_fallback":
      return "cancel";
    default:
      return "failed";
  }
}

export type ClipboardCheck = {
  platform: "ios" | "android" | string;
  /** The app went to the background since the copy. */
  leftApp: boolean;
  /** The clipboard changed while the app was in the foreground. */
  changedInApp: boolean;
  /** Current clipboard text, if it could be read without a system prompt. */
  current?: string;
  secret: string;
};

/**
 * Whether to wipe the clipboard when the copy expires.
 *
 * Android: reading the clipboard in the foreground is silent, so compare and
 * clear only if it still holds the secret.
 * iOS: reading it raises the system paste prompt, so it is never read. Clear
 * only if nothing could have replaced the secret: the app never left the
 * foreground and no in-app copy happened. Otherwise leave it — wiping
 * something the user copied elsewhere would be worse than a stale secret.
 */
export function shouldClearClipboard(c: ClipboardCheck): boolean {
  if (c.platform === "android") return c.current === c.secret;
  return !c.leftApp && !c.changedInApp;
}
