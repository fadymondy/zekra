import type { EngineColors, EngineMode, FontFamilyId } from "./bridge-core";

/*
Decisions the note engine makes, kept pure so they are testable without a
WebView and shared by both sides of the bridge.
*/

/**
 * Which surface a note opens in.
 *
 *   read-only brain              -> rendered (the full web renderer, no editing)
 *   lossy for TipTap             -> rendered + "Edit as markdown" banner; the
 *                                   rich editor would silently drop footnote
 *                                   definitions / raw HTML blocks on save
 *                                   (web/components/notes/lossy-markdown.ts)
 *   the user chose the source    -> source (plain markdown, nothing lost)
 *   otherwise                    -> rich (TipTap, always-on WYSIWYG)
 */
export function chooseMode(input: { editable: boolean; lossy: boolean; sourceRequested: boolean }): EngineMode {
  if (!input.editable) return "rendered";
  if (input.sourceRequested) return "source";
  return input.lossy ? "rendered" : "rich";
}

/** The toolbar's heading button cycles paragraph -> H1 -> H2 -> H3 -> paragraph. */
export function nextHeading(level: number): number {
  return level >= 1 && level < 3 ? level + 1 : level >= 3 ? 0 : 1;
}

const SYSTEM_STACK = `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Noto Sans Arabic", "Geeza Pro", sans-serif`;
const MONO_STACK = `ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", "Droid Sans Mono", monospace`;

/**
 * CSS font stacks for the WebView. Mirrors web's FONT_FAMILIES
 * (web/lib/notes/note-settings.ts), except where web points at its own
 * var(--grid-font-*) — those resolve to Lusail/JetBrains Mono, which the page
 * embeds as "Lusail" when available, so "system" leads with it.
 */
export function fontStack(id: FontFamilyId): string {
  switch (id) {
    case "serif":
      return `Georgia, "Times New Roman", serif`;
    case "sans":
      return `"Helvetica Neue", Helvetica, Arial, sans-serif`;
    case "mono":
      return MONO_STACK;
    case "reading":
      return `"Iowan Old Style", "Palatino Linotype", Palatino, serif`;
    default:
      return `Lusail, ${SYSTEM_STACK}`;
  }
}

export const CODE_FONT_STACK = MONO_STACK;

/** GitHub Light / Dark token colours — web's globals.css defaults, used when
 *  no reading theme is chosen. */
const HL_DEFAULTS = {
  light: {
    "--hl-comment": "#6e7781",
    "--hl-keyword": "#cf222e",
    "--hl-string": "#0a3069",
    "--hl-number": "#0550ae",
    "--hl-title": "#8250df",
    "--hl-attr": "#0550ae",
    "--hl-type": "#953800",
    "--hl-meta": "#6e7781",
  },
  dark: {
    "--hl-comment": "#8b949e",
    "--hl-keyword": "#ff7b72",
    "--hl-string": "#a5d6ff",
    "--hl-number": "#79c0ff",
    "--hl-title": "#d2a8ff",
    "--hl-attr": "#79c0ff",
    "--hl-type": "#ffa657",
    "--hl-meta": "#8b949e",
  },
} as const;

/**
 * The note surface's CSS variables in Zekra's own palette — the same
 * --grid-* names web's stylesheet and themeVars() use, so the engine CSS has
 * one vocabulary whichever source the colours come from.
 */
export function zekraVars(c: EngineColors, scheme: "light" | "dark"): Record<string, string> {
  return {
    "--grid-bg": c.bg,
    "--grid-card": c.card,
    "--grid-soft": c.soft,
    "--grid-fg": c.ink,
    "--grid-body": c.body,
    "--grid-muted": c.muted,
    "--grid-line": c.line,
    "--grid-action": c.action,
    "--grid-gold": c.gold,
    "--grid-danger": c.danger,
    "--zk-code-bg": c.card,
    "--zk-table-stripe": c.card,
    ...HL_DEFAULTS[scheme],
  };
}

/**
 * The absolute URL to fetch an auth-gated note image from, or null if `src`
 * is not one. Only API-relative paths (the /api/notes/image/{ns}/{sha}.ext
 * form the uploader returns) and absolute URLs ON the API origin qualify —
 * the bearer token must never be sent to any other host, whatever a note's
 * markdown says.
 */
export function authImageUrl(src: string, apiUrl: string): string | null {
  const s = (src ?? "").trim();
  const base = apiUrl.replace(/\/+$/, "");
  if (!s || !base) return null;
  if (s.startsWith("//")) return null; // protocol-relative: some other host
  if (s.startsWith("/")) return /^\/api\//.test(s) ? `${base}${s}` : null;
  if (/^https?:\/\//i.test(s)) {
    const origin = (u: string) => {
      const m = /^(https?:\/\/[^/?#]+)/i.exec(u);
      return m ? m[1].toLowerCase() : "";
    };
    return origin(s) === origin(base) && /^https?:\/\/[^/?#]+\/api\//i.test(s) ? s : null;
  }
  return null;
}
