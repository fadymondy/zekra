// Unit tests for the auto-update policy (src/main/update-policy.ts) and the
// loader's formatting helpers (src/shared/update-format.ts). Run against the
// tsc output: `npm test` builds main first.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const out = path.join(__dirname, "..", "out");
const policy = require(path.join(out, "main/update-policy.js"));
const fmt = require(path.join(out, "shared/update-format.js"));

const NOW = 1_800_000_000_000;
const base = {
  autoInstall: true,
  critical: false,
  unsaved: false,
  anyWindowVisible: true,
  idleSeconds: 0,
  snoozedUntil: 0,
  now: NOW,
};
const decide = (over) => policy.decideInstall({ ...base, ...over });

test("idle ≥ 10 min, nothing unsaved, auto-install on → install now", () => {
  assert.equal(decide({ idleSeconds: policy.IDLE_INSTALL_SECONDS }).action, "install");
  assert.equal(decide({ idleSeconds: 3600 }).action, "install");
});

test("user active in a visible window → prompt (in-app card), never install", () => {
  const d = decide({ idleSeconds: 30 });
  assert.equal(d.action, "prompt");
  assert.equal(d.modal, false);
  assert.equal(decide({ idleSeconds: policy.IDLE_INSTALL_SECONDS - 1 }).action, "prompt");
});

test("no window on screen (menubar only) → install after a short idle", () => {
  assert.equal(decide({ anyWindowVisible: false, idleSeconds: policy.HIDDEN_IDLE_INSTALL_SECONDS }).action, "install");
  assert.equal(decide({ anyWindowVisible: false, idleSeconds: 5 }).action, "prompt");
});

test("unsaved edits → never install, even idle or critical", () => {
  assert.equal(decide({ unsaved: true, idleSeconds: 3600 }).action, "prompt");
  const crit = decide({ unsaved: true, critical: true, idleSeconds: 3600 });
  assert.equal(crit.action, "prompt");
  assert.equal(crit.modal, false, "no modal while there is unsaved text");
  assert.equal(decide({ unsaved: true, snoozedUntil: NOW + 1000 }).action, "wait");
});

test("auto-install off → prompt only, even when idle", () => {
  assert.equal(decide({ autoInstall: false, idleSeconds: 3600 }).action, "prompt");
  assert.equal(decide({ autoInstall: false, anyWindowVisible: false, idleSeconds: 3600 }).action, "prompt");
});

test("Later snoozes the prompt until it runs out", () => {
  assert.equal(decide({ snoozedUntil: NOW + 60_000 }).action, "wait");
  assert.equal(decide({ snoozedUntil: NOW - 1 }).action, "prompt");
  // …but an away user still gets the install.
  assert.equal(decide({ snoozedUntil: NOW + 60_000, idleSeconds: 3600 }).action, "install");
});

test("critical → modal prompt (and install on quit), short snooze", () => {
  const d = decide({ critical: true, idleSeconds: 10 });
  assert.equal(d.action, "prompt");
  assert.equal(d.modal, true);
  assert.equal(decide({ critical: true, autoInstall: false, idleSeconds: 3600 }).modal, true);
  assert.equal(decide({ critical: true, idleSeconds: 3600 }).action, "install");
  assert.equal(policy.installOnQuit(false, true), true);
  assert.equal(policy.installOnQuit(false, false), false);
  assert.equal(policy.installOnQuit(true, false), true);
  assert.ok(policy.snoozeFor(true) < policy.snoozeFor(false));
});

test("critical marker in the notes or the title", () => {
  assert.equal(policy.isCriticalRelease({ releaseNotes: "<p>[critical] fixes data loss</p>" }), true);
  assert.equal(policy.isCriticalRelease({ releaseNotes: "Fixes\n\n[CRITICAL]" }), true);
  assert.equal(policy.isCriticalRelease({ releaseNotes: "", releaseName: "v1.2.3 [critical]" }), true);
  assert.equal(policy.isCriticalRelease({ releaseNotes: "critical path perf" }), false);
  assert.equal(policy.isCriticalRelease({ releaseNotes: [{ version: "1.0.1", note: "[critical] x" }] }), true);
  assert.equal(policy.isCriticalRelease({}), false);
});

test("release notes are normalised and shown without the marker", () => {
  assert.equal(policy.normaliseReleaseNotes(null), "");
  assert.equal(policy.normaliseReleaseNotes("  hi \n"), "hi");
  assert.equal(
    policy.normaliseReleaseNotes([
      { version: "1.1.0", note: "b" },
      { version: "1.0.9", note: null },
    ]),
    "### 1.1.0\n\nb",
  );
  assert.equal(policy.stripCriticalMarker("[critical] Fixes sync\n\n\n\n- one"), "Fixes sync\n\n- one");
  assert.equal(policy.stripCriticalMarker("Zekra 1.2 [Critical]"), "Zekra 1.2");
});

test("loader formatting: bytes, transfer, speed, ETA, percent", () => {
  assert.equal(fmt.formatBytes(0), "");
  assert.equal(fmt.formatBytes(999), "999 B");
  assert.equal(fmt.formatBytes(1536), "1.5 KB");
  assert.equal(fmt.formatBytes(98_100_000), "98.1 MB");
  assert.equal(fmt.formatBytes(250_000_000), "250 MB");
  assert.equal(fmt.formatTransfer(12_300_000, 98_100_000), "12.3 MB / 98.1 MB");
  assert.equal(fmt.formatTransfer(undefined, 98_100_000), "98.1 MB");
  assert.equal(fmt.formatSpeed(4_200_000), "4.2 MB/s");
  assert.equal(fmt.formatSpeed(0), "");
  assert.equal(fmt.etaSeconds(50, 100, 10), 5);
  assert.equal(fmt.etaSeconds(50, 100, 0), null);
  assert.equal(fmt.clampPercent(140), 100);
  assert.equal(fmt.clampPercent(-3), 0);
  assert.equal(fmt.clampPercent(undefined), 0);
});
