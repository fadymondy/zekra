#!/usr/bin/env node
// Copies the renderer's non-TS assets (index.html, renderer.css) into
// out/renderer/ alongside the tsc-compiled *.js. Runs after `tsc -p
// tsconfig.renderer.json` as part of `npm run build:renderer`.
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "renderer");
const OUT = path.join(__dirname, "..", "out", "renderer");

fs.mkdirSync(OUT, { recursive: true });
for (const file of ["index.html", "renderer.css"]) {
  fs.copyFileSync(path.join(SRC, file), path.join(OUT, file));
  console.log(`copied ${file} -> out/renderer/${file}`);
}

// Lusail carries Arabic and Latin — the same family the mobile app uses, so
// both clients render the design system in one typeface.
const FONT_SRC = path.join(SRC, "fonts");
const FONT_OUT = path.join(OUT, "fonts");
if (fs.existsSync(FONT_SRC)) {
  fs.mkdirSync(FONT_OUT, { recursive: true });
  for (const font of fs.readdirSync(FONT_SRC)) {
    fs.copyFileSync(path.join(FONT_SRC, font), path.join(FONT_OUT, font));
  }
  console.log(`copied ${fs.readdirSync(FONT_SRC).length} font(s) -> out/renderer/fonts/`);
}
