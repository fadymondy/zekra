#!/usr/bin/env node
/*
App icons, Android adaptive layers and the Android notification icon — all drawn
from the Zekra cube-lattice mark, so they are regenerated from the brand geometry
rather than hand-edited.

The mark is PRODUCT_MARKS.cabrain (web/app/styles/grid-marks.ts; drawn in
web/public/site/icon.svg and desktop/build/icon.svg): eight square cells on a
5 × 4 grid, touching only at corners — no rounding, no gaps, no gradients. Body
cells violet #6D4DE6, the dome cell gold #C9A227, on the dark navy ground
#0B1429 like the desktop icon.

The mark is only axis-aligned squares, so this rasterises it itself and writes
the PNGs with node:zlib — no image library, nothing to install:

  node scripts/make-icons.js

(assets/splash-mark.png is NOT generated here; it belongs to the splash work.)
*/
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// PRODUCT_MARKS.cabrain, normalised to its bounding box (cols 0–4, rows 0–3).
const CELLS = [[2, 0], [1, 1], [3, 1], [0, 2], [2, 2], [4, 2], [1, 3], [3, 3]];
const ACCENT = new Set(["2,0"]);
const COLS = 5;
const ROWS = 4;

const NAVY = "#0B1429"; // ground (desktop icon, dark splash)
const VIOLET = "#6D4DE6"; // body
const GOLD = "#C9A227"; // dome cell
const WHITE = "#FFFFFF";

const OUT = path.join(__dirname, "..", "assets");

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * `size`² pixels with the mark centred, each cell `cell` px. `ground` fills the
 * square (omit → transparent); `mono` draws every cell in one colour.
 */
function draw({ size, cell, ground, mono }) {
  const px = new Uint8Array(size * size * 4); // RGBA, zero = transparent
  const fill = (x0, y0, w, h, hex) => {
    const [r, g, b] = rgb(hex);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * size + x) * 4;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = 255;
      }
    }
  };
  if (ground) fill(0, 0, size, size, ground);
  const ox = Math.round((size - COLS * cell) / 2);
  const oy = Math.round((size - ROWS * cell) / 2);
  for (const [c, r] of CELLS) {
    fill(ox + c * cell, oy + r * cell, cell, cell, mono ?? (ACCENT.has(`${c},${r}`) ? GOLD : VIOLET));
  }
  return px;
}

// ---- PNG ----------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encodes RGBA pixels. `opaque` writes colour type 2 (RGB, NO alpha channel):
 * App Store Connect rejects an icon that has an alpha channel at all, even when
 * every pixel is opaque.
 */
function png(size, px, opaque) {
  const channels = opaque ? 3 : 4;
  const raw = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * channels + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = row + 1 + x * channels;
      raw[d] = px[s];
      raw[d + 1] = px[s + 1];
      raw[d + 2] = px[s + 2];
      if (!opaque) raw[d + 3] = px[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // RGB | RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- targets ------------------------------------------------------------------

const TARGETS = [
  // App Store / iOS icon: 1024², opaque navy; iOS applies its own corner mask.
  // Mark 600 × 480 (≈ 59% wide, the desktop icon's proportion).
  { file: "icon.png", size: 1024, cell: 120, ground: NAVY, opaque: true },
  // Android adaptive icon, 108dp canvas: only the centre 66dp circle is safe
  // (626 px at 1024). The mark's diagonal must fit inside it: 5 × 4 cells of
  // 88 px → 440 × 352, diagonal 563 px. The ground is android.adaptiveIcon.backgroundColor.
  { file: "android-icon-foreground.png", size: 1024, cell: 88 },
  // Themed (Material You) icon: one colour; the launcher tints it.
  { file: "android-icon-monochrome.png", size: 1024, cell: 88, mono: WHITE },
  // Status-bar notification icon: white on transparent (Android draws only the
  // alpha), 96 px = xxxhdpi of the 24dp icon, content inside the 22dp live area.
  { file: "notification-icon.png", size: 96, cell: 16, mono: WHITE },
  // Google Play listing icon (Play Console → Main store listing): 512², opaque.
  { file: "store/play-icon-512.png", size: 512, cell: 60, ground: NAVY, opaque: true },
];

fs.mkdirSync(OUT, { recursive: true });
for (const t of TARGETS) {
  const out = path.join(OUT, t.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png(t.size, draw(t), !!t.opaque));
  console.log(`${t.file.padEnd(30)} ${t.size}x${t.size}${t.opaque ? "" : " alpha"}`);
}
