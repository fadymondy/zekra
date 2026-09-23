import assert from "node:assert/strict";
import { test } from "node:test";

import { THEMES } from "../../../../web/lib/markdown/themes/themes.ts";
import { themeVars } from "../../../../web/lib/markdown/themes/apply.ts";
import { FONT_SIZE_RANGE as WEB_RANGE } from "../../../../web/lib/notes/note-settings.ts";
import {
  DEFAULT_READING,
  FONT_SIZE_RANGE,
  coerceReading,
  contrast,
  mix,
  paletteFromTheme,
  parseColor,
  toHex,
  type PaletteShape,
} from "./reading-core.ts";

const IDS = THEMES.map((t) => t.id);

const BASE: PaletteShape = {
  bg: "#f0ebe1", card: "#f7f4ea", soft: "#ddd5c4", line: "#c7bea9", ink: "#0e1a3c", body: "#4a4438",
  muted: "#6e6551", elevated: "#faf8f3", elevatedLine: "#cfc3af", action: "#6d4de6", onAction: "#ffffff",
  gold: "#c9a227", ok: "#4e9a3e", warn: "#c9a227", danger: "#d9455f",
};

test("font size limits agree with web", () => {
  assert.deepEqual({ ...FONT_SIZE_RANGE }, { ...WEB_RANGE });
});

test("coerce: defaults for garbage", () => {
  assert.deepEqual(coerceReading(null, IDS), DEFAULT_READING);
  assert.deepEqual(coerceReading("x", IDS), DEFAULT_READING);
  assert.deepEqual(coerceReading({ fontSize: "huge", maxWidth: null, fontFamily: "comic" }, IDS), DEFAULT_READING);
});

test("coerce: clamps and keeps valid values", () => {
  const s = coerceReading({ theme: "dracula", fontFamily: "serif", fontSize: 99, maxWidth: 5000, wordWrap: false, lineNumbers: true }, IDS);
  assert.deepEqual(s, { theme: "dracula", fontFamily: "serif", fontSize: 24, maxWidth: 1200, wordWrap: false, lineNumbers: true });
  assert.equal(coerceReading({ fontSize: 3 }, IDS).fontSize, 12);
  assert.equal(coerceReading({ fontSize: 15.6 }, IDS).fontSize, 16);
  assert.equal(coerceReading({ maxWidth: -5 }, IDS).maxWidth, 0);
});

test("coerce: unknown theme falls back to the app palette", () => {
  assert.equal(coerceReading({ theme: "not-a-theme" }, IDS).theme, null);
});

test("coerce: the MH-266 shape still loads", () => {
  const s = coerceReading({ fontSize: 18, theme: "nord" }, IDS);
  assert.equal(s.fontSize, 18);
  assert.equal(s.theme, "nord");
  assert.equal(s.fontFamily, "system");
});

test("colour parsing and compositing", () => {
  assert.deepEqual(parseColor("#abc"), { r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  assert.equal(toHex("#ABCDEF"), "#abcdef");
  assert.equal(toHex("rgba(0,0,0,0.5)", "#ffffff"), "#808080");
  assert.equal(toHex("rgba(175,184,193,0.2)", "#ffffff"), "#eff1f3");
  assert.equal(parseColor("hsl(1,2%,3%)"), null);
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
});

test("every theme maps to an all-hex palette (alpha suffixes must work)", () => {
  for (const theme of THEMES) {
    const p = paletteFromTheme(theme, BASE);
    for (const [key, value] of Object.entries(p)) {
      assert.match(value, /^#[0-9a-f]{6}$/, `${theme.id}.${key} = ${value}`);
    }
  }
});

test("mapping follows web's apply.ts for the tokens web sets", () => {
  for (const theme of THEMES) {
    const p = paletteFromTheme(theme, BASE);
    const v = themeVars(theme);
    const bg = toHex(v["--grid-bg"]);
    assert.equal(p.bg, bg, theme.id);
    assert.equal(p.ink, toHex(v["--grid-fg"], bg), theme.id);
    assert.equal(p.body, toHex(v["--grid-body"], bg), theme.id);
    assert.equal(p.muted, toHex(v["--grid-muted"], bg), theme.id);
    assert.equal(p.line, toHex(v["--grid-line"], bg), theme.id);
    assert.equal(p.soft, toHex(v["--grid-soft"], bg), theme.id);
    assert.equal(p.action, toHex(v["--grid-action"], bg), theme.id);
    // Status colours stay Zekra's.
    assert.equal(p.gold, BASE.gold);
    assert.equal(p.danger, BASE.danger);
    // Cards must be distinguishable from the ground.
    assert.notEqual(p.card, p.bg, theme.id);
  }
});

test("onAction is the more legible of the two candidates", () => {
  for (const theme of THEMES) {
    const p = paletteFromTheme(theme, BASE);
    const other = p.onAction === "#ffffff" ? (theme.kind === "dark" ? p.bg : p.ink) : "#ffffff";
    assert.ok(contrast(p.onAction, p.action) >= contrast(other, p.action), theme.id);
  }
});
