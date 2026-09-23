import assert from "node:assert/strict";
import { test } from "node:test";

import {
  biometricAvailability,
  biometricKind,
  DEFAULT_LOCK,
  lockOnLaunch,
  parseLockSettings,
  serializeLockSettings,
  shouldLockOnReturn,
  shouldOffer,
} from "./lock-core.ts";

test("parseLockSettings round-trips and defaults to off", () => {
  const s = { enabled: true, after: 300 as const, offered: true };
  assert.deepEqual(parseLockSettings(serializeLockSettings(s)), s);
  assert.deepEqual(parseLockSettings(null), DEFAULT_LOCK);
  assert.deepEqual(parseLockSettings(""), DEFAULT_LOCK);
  assert.deepEqual(parseLockSettings("{nope"), DEFAULT_LOCK);
  assert.deepEqual(parseLockSettings("42"), DEFAULT_LOCK);
  assert.deepEqual(parseLockSettings("null"), DEFAULT_LOCK);
});

test("parseLockSettings refuses odd values field by field", () => {
  assert.deepEqual(parseLockSettings(JSON.stringify({ enabled: "true", after: 30, offered: 1 })), DEFAULT_LOCK);
  assert.deepEqual(parseLockSettings(JSON.stringify({ enabled: true, after: "60" })), { enabled: true, after: 0, offered: false });
  assert.deepEqual(parseLockSettings(JSON.stringify({ enabled: true, after: 900 })), { enabled: true, after: 900, offered: false });
});

test("lockOnLaunch: only a signed-in user with the lock on", () => {
  assert.equal(lockOnLaunch({ enabled: true }, true), true);
  assert.equal(lockOnLaunch({ enabled: true }, false), false);
  assert.equal(lockOnLaunch({ enabled: false }, true), false);
});

test("shouldLockOnReturn honours the threshold", () => {
  const t0 = 1_000_000;
  const on = (after: 0 | 60 | 300 | 900) => ({ enabled: true, after });
  assert.equal(shouldLockOnReturn(on(0), true, t0, t0), true, "immediately");
  assert.equal(shouldLockOnReturn(on(60), true, t0, t0 + 59_999), false);
  assert.equal(shouldLockOnReturn(on(60), true, t0, t0 + 60_000), true);
  assert.equal(shouldLockOnReturn(on(300), true, t0, t0 + 120_000), false);
  assert.equal(shouldLockOnReturn(on(900), true, t0, t0 + 900_001), true);
});

test("shouldLockOnReturn: off, signed out, never backgrounded, clock skew", () => {
  const t0 = 1_000_000;
  assert.equal(shouldLockOnReturn({ enabled: false, after: 0 }, true, t0, t0 + 1e9), false);
  assert.equal(shouldLockOnReturn({ enabled: true, after: 0 }, false, t0, t0 + 1e9), false);
  assert.equal(shouldLockOnReturn({ enabled: true, after: 0 }, true, null, t0), false);
  assert.equal(shouldLockOnReturn({ enabled: true, after: 900 }, true, t0, t0 - 1), true, "clock moved back: fail closed");
});

test("shouldOffer: once, after a fresh sign-in, with biometrics set up", () => {
  const fresh = { ...DEFAULT_LOCK };
  assert.equal(shouldOffer(fresh, true, "ready"), true);
  assert.equal(shouldOffer(fresh, false, "ready"), false, "session restore");
  assert.equal(shouldOffer({ ...fresh, offered: true }, true, "ready"), false, "already answered");
  assert.equal(shouldOffer({ ...fresh, enabled: true }, true, "ready"), false, "already on");
  assert.equal(shouldOffer(fresh, true, "notEnrolled"), false);
  assert.equal(shouldOffer(fresh, true, "noHardware"), false);
});

test("biometricKind names the sensor per platform", () => {
  assert.equal(biometricKind([2], "ios"), "faceId");
  assert.equal(biometricKind([1], "ios"), "touchId");
  assert.equal(biometricKind([], "ios"), "biometrics");
  assert.equal(biometricKind([2, 1], "android"), "fingerprint");
  assert.equal(biometricKind([2], "android"), "face");
  assert.equal(biometricKind([3], "android"), "iris");
  assert.equal(biometricKind([], "android"), "biometrics");
});

test("biometricAvailability", () => {
  assert.equal(biometricAvailability(true, true), "ready");
  assert.equal(biometricAvailability(true, false), "notEnrolled");
  assert.equal(biometricAvailability(false, false), "noHardware");
  assert.equal(biometricAvailability(false, true), "noHardware");
});
