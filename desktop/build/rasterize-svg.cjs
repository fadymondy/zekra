// Rasterise an SVG to a transparent PNG with Chromium (via Electron), which
// supports the filters/gradients the icon uses — ImageMagick's built-in MSVG
// renderer does not, and rsvg-convert is not installed here.
//
//   electron build/rasterize-svg.cjs <in.svg> <out.png> <size>
//
// Used by build/make-icons.mjs; not shipped in the app.
"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

const [input, output, sizeArg] = process.argv.slice(-3);
const size = Number(sizeArg) || 1024;

app.disableHardwareAcceleration();
app.dock?.hide();

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(input, "utf8");
    const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
      img{display:block;width:${size}px;height:${size}px}</style></head>
      <body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;
    const win = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true },
    });
    win.webContents.setZoomFactor(1);
    await win.loadURL("data:text/html;base64," + Buffer.from(html).toString("base64"));
    await new Promise((r) => setTimeout(r, 300));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const resized = image.getSize().width === size ? image : image.resize({ width: size, height: size, quality: "best" });
    fs.writeFileSync(output, resized.toPNG());
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
