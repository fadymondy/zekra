import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BODY,
  breathOpacity,
  CELLS,
  cellDelay,
  cellRect,
  DOME,
  domeFrame,
  bodyFrame,
  EXIT_CAP_MS,
  exitFrame,
  flicker,
  INTRO_MS,
  shouldExit,
  T,
  UNIT,
} from "./splash-core.ts";

// The native splash (assets/splash-mark.png) is web/public/site/icon.svg; the
// animated overlay must start on exactly those cells.
const ICON_SVG: [number, number, string][] = [
  [40.8, 13.2, "gold"],
  [22.4, 31.6, "violet"],
  [59.2, 31.6, "violet"],
  [4, 50, "violet"],
  [40.8, 50, "violet"],
  [77.6, 50, "violet"],
  [22.4, 68.4, "violet"],
  [59.2, 68.4, "violet"],
];

test("geometry matches the icon SVG", () => {
  assert.equal(CELLS.length, 8);
  for (const [x, y, fill] of ICON_SVG) {
    const cell = CELLS.find((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.y - y) < 1e-6);
    assert.ok(cell, `no cell at ${x},${y}`);
    assert.equal(cell.gold, fill === "gold");
  }
  assert.ok(DOME.gold);
  // Centred: the lattice spans 4 → 96 and 13.2 → 86.8 in a 100 box.
  const xs = CELLS.map((c) => c.x);
  const ys = CELLS.map((c) => c.y);
  assert.ok(Math.abs(Math.min(...xs) - (100 - (Math.max(...xs) + UNIT))) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys) - (100 - (Math.max(...ys) + UNIT))) < 1e-6);
});

test("cascade climbs from the bottom row", () => {
  assert.equal(BODY.length, 7);
  const rows = BODY.map((c) => c.row);
  assert.deepEqual(rows, [...rows].sort((a, b) => b - a));
  for (let i = 1; i < BODY.length; i++) assert.ok(cellDelay(i) > cellDelay(i - 1));
});

test("first and last frames are the native splash", () => {
  for (let i = 0; i < BODY.length; i++) {
    assert.deepEqual(bodyFrame(i, 0), { scale: 1, opacity: 1, dy: 0 });
    assert.deepEqual(bodyFrame(i, INTRO_MS), { scale: 1, opacity: 1, dy: 0 });
  }
  assert.deepEqual(domeFrame(0), { scale: 1, opacity: 1, dy: 0 });
  assert.deepEqual(domeFrame(INTRO_MS), { scale: 1, opacity: 1, dy: 0 });
  assert.deepEqual(cellRect(DOME, { scale: 1, dy: 0 }), { x: DOME.x, y: DOME.y, width: UNIT, height: UNIT });
});

test("cells dip mid-pulse and the dome lifts before it lands", () => {
  const mid = bodyFrame(0, cellDelay(0) + T.cellPulse * 0.38);
  assert.ok(mid.scale < 0.6 && mid.opacity < 0.4);
  const up = domeFrame(T.domeLift + T.domeLiftFor);
  assert.ok(up.dy < -UNIT * 0.5);
  // The settle overshoots below the resting place at some point in the drop.
  let below = false;
  for (let t = T.domeLift + T.domeLiftFor; t <= T.domeLift + T.domeLiftFor + T.domeDropFor; t += 5) {
    if (domeFrame(t).dy > 0) below = true;
  }
  assert.ok(below);
  // A scaled rect stays centred on its cell.
  const r = cellRect(DOME, { scale: 0.5, dy: 0 });
  assert.ok(Math.abs(r.x + r.width / 2 - (DOME.x + UNIT / 2)) < 1e-9);
});

test("timing budget", () => {
  assert.ok(INTRO_MS >= 900 && INTRO_MS <= 1200, `intro ${INTRO_MS}ms`);
  assert.ok(EXIT_CAP_MS + T.exit <= 1400);
  assert.ok(!shouldExit(false, true, 5000));
  assert.ok(!shouldExit(true, false, 200));
  assert.ok(shouldExit(true, true, 200));
  assert.ok(shouldExit(true, false, EXIT_CAP_MS));
});

test("flicker, breath and exit stay in range", () => {
  for (let t = 0; t < 1400; t += 7) {
    for (let i = 0; i < 8; i++) {
      const f = flicker(i, t);
      assert.ok(f >= 0.5 && f <= 1);
    }
  }
  for (let p = 0; p <= 1; p += 0.05) {
    for (let i = 0; i < 8; i++) {
      const o = breathOpacity(i, p);
      assert.ok(o >= 0.69 && o <= 1);
    }
  }
  assert.deepEqual(exitFrame(0), { scale: 1, opacity: 1 });
  const end = exitFrame(1);
  assert.ok(end.opacity === 0 && end.scale > 1.1);
});
