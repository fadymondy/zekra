// Pure geometry and timing for the launch splash (MH-372). No React / RN, so
// `node --test` covers it (splash-core.test.ts). The keyframe functions carry
// the "worklet" directive: Reanimated runs them on the UI thread, Node just
// ignores the string.

// ─── Geometry ───────────────────────────────────────────────────────────────
// The Zekra mark (web/app/styles/grid-marks.ts PRODUCT_MARKS.cabrain): a gold
// dome cell over seven violet cells on a 5×4 lattice. Coordinates are those of
// web/public/site/icon.svg — a 100×100 box, cells 18.4 wide, lattice origin at
// (4, 13.2) — so the SVG, the native splash PNG (assets/splash-mark.png) and
// the animated overlay all place every cell on the same pixel.

export const VIEWBOX = 100;
export const UNIT = 18.4;
export const ORIGIN_X = 4;
export const ORIGIN_Y = 13.2;

/** Native splash: app.json expo-splash-screen `imageWidth` (square image). */
export const MARK_SIZE = 96;

export const GOLD = "#C9A227";
export const VIOLET = "#6D4DE6";

/** Grounds of the native splash (app.json backgroundColor / dark). */
export const GROUND = { light: "#f0ebe1", dark: "#0b1429" } as const;

export type Cell = { col: number; row: number; gold: boolean; x: number; y: number };

/** Lattice cells (col, row) — the dome first, then the body. */
const LATTICE: [number, number][] = [
  [3, 0],
  [2, 1],
  [4, 1],
  [1, 2],
  [3, 2],
  [5, 2],
  [2, 3],
  [4, 3],
];

export const CELLS: Cell[] = LATTICE.map(([col, row], i) => ({
  col,
  row,
  gold: i === 0,
  x: round(ORIGIN_X + (col - 1) * UNIT),
  y: round(ORIGIN_Y + row * UNIT),
}));

/** The seven violet cells, in cascade order: bottom row first, then each row
 *  from the start edge — a sweep that climbs the lattice toward the dome. */
export const BODY: Cell[] = CELLS.filter((c) => !c.gold).sort((a, b) => b.row - a.row || a.col - b.col);
export const DOME: Cell = CELLS[0];

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

// ─── Timing (ms) ────────────────────────────────────────────────────────────
// The first frame is the native splash, exactly: every cell in place. The
// intro then re-seats the body cells in a cascade (each dips and springs back
// from the grid), lifts the dome and drops it into place with a small settle,
// and closes on a Ben-Day flicker, like the web's LogoLoader.

export const T = {
  cascadeStart: 60,
  rowStep: 100,
  colStep: 30,
  cellPulse: 320,
  domeLift: 430,
  domeLiftFor: 150,
  domeDropFor: 240,
  flickerStart: 800,
  flickerStep: 18,
  flickerFor: 160,
  exit: 300,
  /** A ready app is never held longer than this from launch. */
  maxBlock: 1400,
  breath: 1600,
} as const;

/** Start of each body cell's pulse, in cascade order: rows step up from the
 *  bottom, cells within a row step from the start edge. */
export const DELAYS: number[] = BODY.map((c) => {
  const inRow = BODY.filter((b) => b.row === c.row).indexOf(c);
  return T.cascadeStart + (BODY[0].row - c.row) * T.rowStep + inRow * T.colStep;
});

/** When body cell `i` (cascade order) starts its pulse. */
export function cellDelay(i: number): number {
  "worklet";
  return DELAYS[i] ?? 0;
}

export const INTRO_MS = Math.max(
  cellDelay(BODY.length - 1) + T.cellPulse,
  T.domeLift + T.domeLiftFor + T.domeDropFor,
  T.flickerStart + (CELLS.length - 1) * T.flickerStep + T.flickerFor,
);

/** Latest moment the exit may start so a ready app is shown within maxBlock. */
export const EXIT_CAP_MS = T.maxBlock - T.exit;

/** Whether to start the exit now. */
export function shouldExit(ready: boolean, introDone: boolean, elapsed: number): boolean {
  return ready && (introDone || elapsed >= EXIT_CAP_MS);
}

// ─── Keyframes ──────────────────────────────────────────────────────────────

function clamp01(x: number) {
  "worklet";
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function easeOutCubic(x: number) {
  "worklet";
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

function easeInOutSine(x: number) {
  "worklet";
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/** easeOutBack: overshoots then settles (the dome's landing). */
function easeOutBack(x: number) {
  "worklet";
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export type Frame = { scale: number; opacity: number; dy: number };

// Declared before its callers on purpose: the worklets Babel plugin rewrites
// worklet function declarations as consts, so they are no longer hoisted, and a
// worklet captures its dependencies at the point it is defined.
/** The closing Ben-Day flicker: each cell blinks down to 0.5 once, staggered
 *  in lattice order. */
export function flicker(index: number, t: number): number {
  "worklet";
  const p = clamp01((t - T.flickerStart - index * T.flickerStep) / T.flickerFor);
  if (p <= 0 || p >= 1) return 1;
  return 1 - 0.5 * Math.sin(Math.PI * p);
}

/** A body cell at time `t`: dips to 0.55 scale / 0.35 opacity, then springs
 *  back through a slight overshoot. Identity outside its window. */
export function bodyFrame(i: number, t: number): Frame {
  "worklet";
  const p = clamp01((t - cellDelay(i)) / T.cellPulse);
  if (p <= 0 || p >= 1) return { scale: 1, opacity: flicker(i + 1, t), dy: 0 };
  const down = 0.38;
  if (p < down) {
    const k = easeInOutSine(p / down);
    return { scale: 1 - 0.45 * k, opacity: 1 - 0.65 * k, dy: 0 };
  }
  const k = easeOutBack((p - down) / (1 - down));
  return { scale: 0.55 + 0.45 * k, opacity: 0.35 + 0.65 * clamp01(k), dy: 0 };
}

/** The dome at time `t`: lifts half a cell, then drops back with a settle.
 *  `dy` is in viewBox units (negative = up). */
export function domeFrame(t: number): Frame {
  "worklet";
  const lift = clamp01((t - T.domeLift) / T.domeLiftFor);
  const drop = clamp01((t - T.domeLift - T.domeLiftFor) / T.domeDropFor);
  const high = -UNIT * 0.55;
  let dy = 0;
  if (lift > 0 && drop <= 0) dy = high * easeOutCubic(lift);
  else if (drop > 0 && drop < 1) dy = high * (1 - easeOutBack(drop));
  return { scale: 1, opacity: flicker(0, t), dy };
}

/** While waiting on a slow launch: a gentle wave of opacity through the
 *  cells. `phase` loops 0→1; cell `index` lags by its lattice position. */
export function breathOpacity(index: number, phase: number): number {
  "worklet";
  const x = phase - index / CELLS.length;
  return 1 - 0.3 * (0.5 - 0.5 * Math.cos(2 * Math.PI * x));
}

/** Rect geometry for a cell scaled about its own centre and shifted by `dy`. */
export function cellRect(cell: Pick<Cell, "x" | "y">, f: Pick<Frame, "scale" | "dy">) {
  "worklet";
  const size = UNIT * f.scale;
  const inset = (UNIT - size) / 2;
  return { x: cell.x + inset, y: cell.y + inset + f.dy, width: size, height: size };
}

/** Exit: the mark grows a little while the overlay fades. `e` is 0→1. */
export function exitFrame(e: number): { scale: number; opacity: number } {
  "worklet";
  const k = clamp01(e);
  return { scale: 1 + 0.14 * easeOutCubic(k), opacity: 1 - k * k };
}
