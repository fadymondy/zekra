// Generates the app icons (macOS .icns, Windows .ico, Linux PNG set) and the
// macOS menubar template icon.
//
//   npm run icons
//
//   build/icon.svg  --(Chromium via Electron)-->  build/icon.png (1024)
//                   --(sips)--> build/icon.iconset/* --(iconutil)--> build/icon.icns
//   (drawn with ImageMagick) -> build/trayTemplate.png (18px) + @2x (36px)
//
// The outputs are committed, so a normal build does not need these tools; run
// this only after changing icon.svg. Requires macOS (sips, iconutil) and
// ImageMagick (`magick`) for the tray icon.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILD = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(BUILD, "..");
const electron = path.join(DESKTOP, "node_modules", ".bin", "electron");
// ELECTRON_RUN_AS_NODE (set by some tool hosts) would make electron a plain
// node and `require("electron").app` undefined.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"], env });

/* ---------------------------------------------------------- app icon */

const master = path.join(BUILD, "icon.png");
run(electron, [path.join(BUILD, "rasterize-svg.cjs"), path.join(BUILD, "icon.svg"), master, "1024"]);

const iconset = path.join(BUILD, "icon.iconset");
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = base * scale;
    const name = `icon_${base}x${base}${scale === 2 ? "@2x" : ""}.png`;
    run("sips", ["-z", String(px), String(px), master, "--out", path.join(iconset, name)]);
  }
}
run("iconutil", ["-c", "icns", iconset, "-o", path.join(BUILD, "icon.icns")]);
fs.rmSync(iconset, { recursive: true, force: true });

/* --------------------------------------------- Windows + Linux icons */

// Windows: a multi-size .ico (installer, exe, taskbar, the tray).
// Linux: the hicolor PNG set electron-builder installs (build/icons/NxN.png).
run("magick", [master, "-define", "icon:auto-resize=256,128,64,48,32,24,16", path.join(BUILD, "icon.ico")]);
fs.mkdirSync(path.join(BUILD, "icons"), { recursive: true });
for (const px of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  run("magick", [master, "-resize", `${px}x${px}`, "-define", "png:color-type=6", path.join(BUILD, "icons", `${px}x${px}.png`)]);
}

/* ------------------------------------------------------ tray template */

// The mark's lattice (5 cols x 4 rows, cells at [col,row]) in black on
// transparent — macOS tints template images for the menubar. 18pt canvas:
// 3px cells at 1x, 6px at 2x, pixel-aligned so it stays crisp.
const CELLS = [[3, 0], [2, 1], [4, 1], [1, 2], [3, 2], [5, 2], [2, 3], [4, 3]];
function tray(scale, file) {
  const unit = 3 * scale;
  const size = 18 * scale;
  const ox = 1 * scale; // (18 - 15) / 2, rounded down; cols start at 1
  const oy = 3 * scale; // (18 - 12) / 2
  const draws = CELLS.flatMap(([c, r]) => {
    const x = ox + (c - 1) * unit;
    const y = oy + r * unit;
    return ["-draw", `rectangle ${x},${y} ${x + unit - 1},${y + unit - 1}`];
  });
  run("magick", ["-size", `${size}x${size}`, "xc:none", "-fill", "black", ...draws, "-define", "png:color-type=6", path.join(BUILD, file)]);
}
tray(1, "trayTemplate.png");
tray(2, "trayTemplate@2x.png");

console.log("icons written: build/icon.png, build/icon.icns, build/icon.ico, build/icons/*.png, build/trayTemplate.png, build/trayTemplate@2x.png");
