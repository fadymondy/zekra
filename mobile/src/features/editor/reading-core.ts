import type { ThemeDefinition } from "@shared/markdown/themes/themes";

import type { FontFamilyId } from "./bridge-core";

/*
Reading settings + reading-theme -> app palette (MH-366). Pure: no runtime
imports, so node --test can load it and both theme.ts and the settings store
share one implementation.
*/

// ─── Settings ───────────────────────────────────────────────────────────────

/** The web note settings (web/lib/notes/note-settings.ts) minus autosave,
 *  which mobile always does (800ms after the last change, like web). */
export interface ReadingSettings {
  /** Reading theme id, or null for the app's own palette. */
  theme: string | null;
  fontFamily: FontFamilyId;
  /** Body size in px. */
  fontSize: number;
  /** Reading column cap in px; 0 = full width. */
  maxWidth: number;
  wordWrap: boolean;
  lineNumbers: boolean;
}

/** Same limits as web's FONT_SIZE_RANGE (pinned by a test). */
export const FONT_SIZE_RANGE = { min: 12, max: 24 } as const;
export const MAX_WIDTH_MAX = 1200;
/** The widths offered on a phone/tablet. 0 = full. */
export const MAX_WIDTH_OPTIONS = [0, 640, 760, 960] as const;
export const FONT_FAMILY_IDS: readonly FontFamilyId[] = ["system", "serif", "sans", "mono", "reading"];

export const DEFAULT_READING: ReadingSettings = {
  theme: null,
  fontFamily: "system",
  fontSize: 16,
  maxWidth: 0,
  wordWrap: true,
  lineNumbers: false,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Validate anything read back off the device. It may be corrupt or from an
 * older build (the MH-266 shape was just {fontSize, theme}), so each field is
 * checked rather than spread — a bad fontSize must not make notes unreadable.
 * `themeIds` is the known catalogue: an unknown id falls back to the palette.
 */
export function coerceReading(raw: unknown, themeIds: readonly string[]): ReadingSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const size = typeof o.fontSize === "number" ? o.fontSize : Number(o.fontSize);
  const width = typeof o.maxWidth === "number" ? o.maxWidth : Number(o.maxWidth);
  return {
    theme: typeof o.theme === "string" && themeIds.includes(o.theme) ? o.theme : null,
    fontFamily: FONT_FAMILY_IDS.includes(o.fontFamily as FontFamilyId) ? (o.fontFamily as FontFamilyId) : DEFAULT_READING.fontFamily,
    fontSize: Number.isFinite(size) && o.fontSize !== null && o.fontSize !== ""
      ? clamp(Math.round(size), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
      : DEFAULT_READING.fontSize,
    maxWidth: Number.isFinite(width) && o.maxWidth !== null && o.maxWidth !== "" ? clamp(Math.round(width), 0, MAX_WIDTH_MAX) : 0,
    wordWrap: typeof o.wordWrap === "boolean" ? o.wordWrap : DEFAULT_READING.wordWrap,
    lineNumbers: typeof o.lineNumbers === "boolean" ? o.lineNumbers : DEFAULT_READING.lineNumbers,
  };
}

// ─── Colour maths ───────────────────────────────────────────────────────────

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(). Anything else -> null. */
export function parseColor(input: string): Rgba | null {
  const s = (input ?? "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = hex.split("").map((c) => c + c).join("");
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255), a: clamp(alpha, 0, 1) };
  }
  return null;
}

const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

/**
 * An opaque #rrggbb. Translucent colours (several themes use rgba for inline
 * code) are composited over `over`. The app appends alpha suffixes like
 * `${p.gold}1A`, which only works on 6-digit hex — so every palette colour
 * must come out of here.
 */
export function toHex(color: string, over = "#ffffff"): string {
  const c = parseColor(color);
  if (!c) return "#000000";
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  const base = parseColor(over) ?? { r: 255, g: 255, b: 255, a: 1 };
  const mixC = (fg: number, bg: number) => fg * c.a + bg * (1 - c.a);
  return `#${hex2(mixC(c.r, base.r))}${hex2(mixC(c.g, base.g))}${hex2(mixC(c.b, base.b))}`;
}

/** Linear blend: t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(toHex(a)) as Rgba;
  const y = parseColor(toHex(b)) as Rgba;
  const f = (p: number, q: number) => p + (q - p) * t;
  return `#${hex2(f(x.r, y.r))}${hex2(f(x.g, y.g))}${hex2(f(x.b, y.b))}`;
}

/** WCAG relative luminance. */
export function luminance(color: string): number {
  const c = parseColor(toHex(color)) as Rgba;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ─── Reading theme -> app palette ───────────────────────────────────────────

/** The shape of theme.ts's Palette, restated so this file needs no runtime import. */
export interface PaletteShape {
  bg: string;
  card: string;
  soft: string;
  line: string;
  ink: string;
  body: string;
  muted: string;
  elevated: string;
  elevatedLine: string;
  action: string;
  onAction: string;
  gold: string;
  ok: string;
  warn: string;
  danger: string;
}

/**
 * Repaint the WHOLE app from a reading theme, the way web does it
 * (web/lib/markdown/themes/apply.ts themeVars -> --grid-*):
 *
 *   --grid-bg     bg              -> bg
 *   --grid-soft   inlineCodeBg    -> soft (composited opaque)
 *   --grid-fg     fg              -> ink
 *   --grid-body   fg              -> body
 *   --grid-muted  fgMuted         -> muted
 *   --grid-line   border          -> line, elevatedLine
 *   --grid-action link            -> action
 *
 * Where mobile has a token web's theme vars do not set, it is derived:
 *   card / elevated  codeBg — web paints --grid-card = bg, but mobile sheets
 *                    and inputs sit on `card`, and an identical colour would
 *                    make every sheet edge vanish; codeBg is each theme's own
 *                    "slightly shifted ground".
 *   onAction         whichever of white / the theme's darkest text reads
 *                    better on the action colour.
 *   gold/ok/warn/danger  kept from Zekra's light or dark scale (per theme
 *                    kind) — they are status colours, not theme colours.
 */
export function paletteFromTheme(theme: Pick<ThemeDefinition, "kind" | "palette">, base: PaletteShape): PaletteShape {
  const p = theme.palette;
  const bg = toHex(p.bg);
  let card = toHex(p.codeBg, bg);
  // A few themes set codeBg == bg; nudge toward fg so surfaces stay distinct.
  if (card === bg) card = mix(bg, toHex(p.fg, bg), 0.04);
  const fg = toHex(p.fg, bg);
  const action = toHex(p.link, bg);
  const darkText = theme.kind === "dark" ? bg : fg;
  const onAction = contrast("#ffffff", action) >= contrast(darkText, action) ? "#ffffff" : darkText;
  return {
    bg,
    card,
    soft: toHex(p.inlineCodeBg, bg),
    line: toHex(p.border, bg),
    ink: fg,
    body: fg,
    muted: toHex(p.fgMuted, bg),
    elevated: card,
    elevatedLine: toHex(p.border, bg),
    action,
    onAction,
    gold: base.gold,
    ok: base.ok,
    warn: base.warn,
    danger: base.danger,
  };
}
