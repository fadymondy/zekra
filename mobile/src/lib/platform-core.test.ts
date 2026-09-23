import assert from "node:assert/strict";
import { test } from "node:test";

import { isLiquidGlassOS, majorVersion } from "./platform-core.ts";

test("majorVersion reads iOS version strings", () => {
  assert.equal(majorVersion("27.0"), 27);
  assert.equal(majorVersion("26.0.1"), 26);
  assert.equal(majorVersion("26"), 26);
  assert.equal(majorVersion("18.6"), 18);
  assert.equal(majorVersion(" 26.1 "), 26);
});

test("majorVersion is 0 for anything unparseable", () => {
  assert.equal(majorVersion(""), 0);
  assert.equal(majorVersion("beta"), 0);
  assert.equal(majorVersion(undefined), 0);
  assert.equal(majorVersion(null), 0);
  assert.equal(majorVersion(Number.NaN), 0);
  assert.equal(majorVersion(-3), 0);
});

test("majorVersion passes numbers through (Android API level)", () => {
  assert.equal(majorVersion(35), 35);
  assert.equal(majorVersion(26.9), 26);
});

test("Liquid Glass is iOS 26 and newer", () => {
  assert.equal(isLiquidGlassOS("ios", "26.0"), true);
  assert.equal(isLiquidGlassOS("ios", "27.0"), true);
  assert.equal(isLiquidGlassOS("ios", "30.2"), true);
  assert.equal(isLiquidGlassOS("ios", "18.6"), false);
  assert.equal(isLiquidGlassOS("ios", "25.9"), false);
  assert.equal(isLiquidGlassOS("ios", undefined), false);
});

test("Android is never Liquid Glass, even at API level 26+", () => {
  assert.equal(isLiquidGlassOS("android", 26), false);
  assert.equal(isLiquidGlassOS("android", 35), false);
  assert.equal(isLiquidGlassOS("web", "27.0"), false);
});
