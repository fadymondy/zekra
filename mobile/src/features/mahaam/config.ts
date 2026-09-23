// Mahaam SDK configuration. Every value can be overridden from the build
// environment (mobile/.env or the CI environment); EXPO_PUBLIC_* values are
// inlined at bundle time, so they must be read as literal process.env.X.
//
// The feedback key is PUBLIC by design (a pfk_ key can do exactly one thing:
// file an issue into the Zekra project on Mahaam) — safe to ship in the binary.

const env = (v: string | undefined) => (v ?? "").trim();

/** Zekra's project feedback key on Mahaam ("Zekra console"). */
const DEFAULT_FEEDBACK_KEY = "pfk_36347a7527f6d2c46628b8e14c082430";
const DEFAULT_FEEDBACK_URL = "https://console.mahaam.app/api/feedback/embed";
/**
 * An origin on the key's allowlist. Native requests carry no Origin header, so
 * the intake checks the origin of `page_url` instead (embed.go) — that is the
 * server's own path for non-browser callers (the Mahaam Go SDK does the same
 * with its AppURL), not a spoofed header.
 */
const DEFAULT_APP_URL = "https://app.zekra.dev";

export const MAHAAM_FEEDBACK_KEY = env(process.env.EXPO_PUBLIC_MAHAAM_FEEDBACK_KEY) || DEFAULT_FEEDBACK_KEY;
export const MAHAAM_FEEDBACK_URL = env(process.env.EXPO_PUBLIC_MAHAAM_FEEDBACK_URL) || DEFAULT_FEEDBACK_URL;
export const MAHAAM_APP_URL = env(process.env.EXPO_PUBLIC_MAHAAM_APP_URL) || DEFAULT_APP_URL;

/**
 * Error monitoring (the DSN-based Mahaam SDK). No default: a project monitor
 * DSN (https://mdsn_…@console.mahaam.app/monitor/<project>) is minted in
 * Mahaam → project → Settings → Monitoring. Unset → monitoring is off.
 */
export const MAHAAM_DSN = env(process.env.EXPO_PUBLIC_MAHAAM_DSN);

export const feedbackEnabled = () => MAHAAM_FEEDBACK_KEY.startsWith("pfk_") && /^https?:\/\//.test(MAHAAM_FEEDBACK_URL);
