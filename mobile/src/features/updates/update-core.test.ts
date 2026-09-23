import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareVersions,
  defaultStoreUrl,
  dueForCheck,
  formatBytes,
  isEditorRoute,
  isOlder,
  parseItunesLookup,
  parseVersionManifest,
  pickLatest,
  planOta,
  progressFraction,
  storeDecision,
} from "./update-core.ts";

test("compareVersions: numeric, padded, pre-release before release", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("v2.0.0", "1.99"), 1);
  assert.equal(compareVersions("1.2.0-beta.1", "1.2.0"), -1);
  assert.equal(compareVersions("1.2.0+45", "1.2.0"), 0);
  assert.equal(compareVersions("latest", "1.0.0"), null);
  assert.equal(compareVersions(null, "1.0.0"), null);
  assert.equal(isOlder("0.1.0", "0.1.1"), true);
  assert.equal(isOlder("0.1.1", "0.1.1"), false);
  assert.equal(isOlder("garbage", "0.1.1"), false);
});

test("store decision: force below minimum, prompt once per newer version", () => {
  assert.deepEqual(storeDecision({ installed: "0.1.0", minimum: "0.2.0", latest: "0.3.0" }), { kind: "force", minimum: "0.2.0", version: "0.3.0" });
  assert.deepEqual(storeDecision({ installed: "0.2.0", minimum: "0.2.0", latest: "0.3.0" }), { kind: "prompt", version: "0.3.0" });
  assert.deepEqual(storeDecision({ installed: "0.2.0", latest: "0.3.0", dismissedVersion: "0.3.0" }), { kind: "none" });
  assert.deepEqual(storeDecision({ installed: "0.2.0", latest: "0.4.0", dismissedVersion: "0.3.0" }), { kind: "prompt", version: "0.4.0" });
  assert.deepEqual(storeDecision({ installed: "0.3.0", latest: "0.3.0" }), { kind: "none" });
  assert.deepEqual(storeDecision({ installed: "0.4.0", latest: "0.3.0" }), { kind: "none" });
  // Dismissing never beats the minimum.
  assert.equal(storeDecision({ installed: "0.1.0", minimum: "0.2.0", dismissedVersion: "0.2.0" }).kind, "force");
  // No usable installed version (web / dev): nothing.
  assert.deepEqual(storeDecision({ installed: null, minimum: "9.0.0" }), { kind: "none" });
});

test("pickLatest takes the highest valid candidate", () => {
  assert.equal(pickLatest("0.2.0", null, "0.10.0", "x"), "0.10.0");
  assert.equal(pickLatest(undefined, null), null);
});

test("version manifest parsing is defensive", () => {
  const json = {
    ios: { minimumVersion: "0.1.0", latestVersion: "0.2.0", storeUrl: "https://apps.apple.com/app/id1", message: { en: "Update", ar: "حدّث" } },
    android: { minimumVersion: "nope", latestVersion: " 0.3.0 ", storeUrl: "javascript:alert(1)" },
  };
  assert.deepEqual(parseVersionManifest(json, "ios"), {
    minimumVersion: "0.1.0",
    latestVersion: "0.2.0",
    storeUrl: "https://apps.apple.com/app/id1",
    message: { en: "Update", ar: "حدّث" },
  });
  assert.deepEqual(parseVersionManifest(json, "android"), { latestVersion: "0.3.0" });
  assert.deepEqual(parseVersionManifest(null, "ios"), {});
  assert.deepEqual(parseVersionManifest("<html>", "ios"), {});
  assert.deepEqual(parseVersionManifest({ ios: 3 }, "ios"), {});
});

test("iTunes lookup parsing", () => {
  assert.deepEqual(parseItunesLookup({ resultCount: 1, results: [{ version: "1.4.0", trackViewUrl: "https://apps.apple.com/app/zekra/id9", releaseNotes: "Fixes" }] }), {
    version: "1.4.0",
    storeUrl: "https://apps.apple.com/app/zekra/id9",
    releaseNotes: "Fixes",
  });
  assert.equal(parseItunesLookup({ resultCount: 0, results: [] }), null);
  assert.equal(parseItunesLookup({ results: [{ version: "" }] }), null);
  assert.equal(parseItunesLookup(undefined), null);
});

test("store URLs", () => {
  assert.equal(defaultStoreUrl("android", "com.fadymondy.zekra"), "https://play.google.com/store/apps/details?id=com.fadymondy.zekra");
  assert.match(defaultStoreUrl("ios", "com.fadymondy.zekra"), /^https:\/\/apps\.apple\.com\//);
});

test("OTA plan: mandatory blocks and restarts, unless the editor is open", () => {
  assert.deepEqual(planOta({ isMandatory: true }, { editing: false }), { installMode: "IMMEDIATE", ui: "blocking", restartNow: true });
  assert.deepEqual(planOta({ isMandatory: true }, { editing: true }), { installMode: "IMMEDIATE", ui: "silent", restartNow: false });
});

test("OTA plan: optional updates prompt and apply on the next resume", () => {
  assert.deepEqual(planOta({ isMandatory: false }, { editing: false }), { installMode: "ON_NEXT_RESUME", ui: "sheet", restartNow: false });
  assert.equal(planOta({ isMandatory: false }, { editing: true }).ui, "silent");
  assert.equal(planOta({ isMandatory: false }, { editing: false, dismissedLabel: true }).ui, "silent");
});

test("helpers: throttling, progress, bytes, editor route", () => {
  assert.equal(dueForCheck(null, 1000, 500), true);
  assert.equal(dueForCheck(800, 1000, 500), false);
  assert.equal(dueForCheck(400, 1000, 500), true);
  assert.equal(progressFraction(50, 200), 0.25);
  assert.equal(progressFraction(300, 200), 1);
  assert.equal(progressFraction(5, 0), null);
  assert.equal(formatBytes(2_400_000), "2.4 MB");
  assert.equal(formatBytes(0), "");
  assert.equal(isEditorRoute("/note/abc"), true);
  assert.equal(isEditorRoute("/brains"), false);
  assert.equal(isEditorRoute("/note"), false);
});
