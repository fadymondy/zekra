#!/usr/bin/env node
// Generates build/icon.png (and build/icon-256.png) as a hand-rolled PNG, with zero
// external dependencies (Node's built-in zlib only), reproducing the icon.svg pattern
// (the cabrain brand cube mark on a dark-ink ground). This exists because no SVG/image
// conversion tool (ImageMagick, rsvg-convert, sharp, Inkscape) is available in this
// environment. It is a *placeholder* PNG suitable for electron-builder's `icon` field
// on Linux (which accepts PNG directly); Windows/macOS packaging needs a real .ico/.icns
// derived from build/icon.svg — see desktop/README.md for the follow-up step.
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 256;
const INK = [0x0b, 0x14, 0x29]; // #0b1429
const VIOLET = [0x6d, 0x4d, 0xe6]; // #6d4de6
const GOLD = [0xc9, 0xa2, 0x27]; // #c9a227

// Same layout as build/icon.svg: an 6x4 cell grid (60px cells in a 512 canvas,
// origin offset 76,96), rescaled to this canvas.
const CELL = SIZE / (512 / 60); // cell size in output px
const OFFSET_X = (76 / 512) * SIZE;
const OFFSET_Y = (96 / 512) * SIZE;

const cells = [
  [3, 0, GOLD],
  [2, 1, VIOLET],
  [4, 1, VIOLET],
  [1, 2, VIOLET],
  [3, 2, VIOLET],
  [5, 2, VIOLET],
  [2, 3, VIOLET],
  [4, 3, VIOLET],
];

function colorAt(x, y) {
  for (const [col, row, color] of cells) {
    const cx = OFFSET_X + col * CELL;
    const cy = OFFSET_Y + row * CELL;
    if (x >= cx && x < cx + CELL && y >= cy && y < cy + CELL) return color;
  }
  return INK;
}

function buildRawRGBA() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4)); // filter byte + RGBA per row
  let offset = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0; // no filter
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = colorAt(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = 255;
    }
  }
  return raw;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function makePNG() {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = buildRawRGBA();
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const outDir = __dirname;
const png = makePNG();
fs.writeFileSync(path.join(outDir, "icon.png"), png);
console.log(`Wrote ${path.join(outDir, "icon.png")} (${SIZE}x${SIZE})`);
