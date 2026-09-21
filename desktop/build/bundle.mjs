// Zekra desktop renderer build.
//
// The renderer is a React app that uses the SAME shadcn components, tokens and
// fonts as the web console (web/components/ui, web/app/styles/grid-*), so the
// desktop app cannot drift from the web design system.
//
// npm cannot install anything in this environment, so nothing is added to
// desktop/package.json: React, the shadcn deps and the Tailwind toolchain are
// all resolved out of web/node_modules, and esbuild is borrowed from
// web-legacy/node_modules. That is why this is a hand-rolled script rather than
// a normal bundler config.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO = path.resolve(DESKTOP, "..");
const WEB = path.join(REPO, "web");
const OUT = path.join(DESKTOP, "out", "renderer");

const webRequire = createRequire(path.join(WEB, "package.json"));
const legacyRequire = createRequire(path.join(REPO, "web-legacy", "package.json"));
const fromWeb = (id) => import(pathToFileURL(webRequire.resolve(id)).href);

const posix = (p) => p.split(path.sep).join("/");

/* ------------------------------------------------------------------ JS */

async function bundleJs({ dev }) {
  const esbuild = legacyRequire("esbuild");
  await esbuild.build({
    entryPoints: [path.join(DESKTOP, "src", "renderer", "main.tsx")],
    outfile: path.join(OUT, "app.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    jsx: "automatic",
    jsxImportSource: "react",
    minify: !dev,
    sourcemap: dev,
    // shadcn components import "@/lib/utils" and "@/components/ui/*" — point
    // that alias at the web app so they resolve to the real components.
    alias: { "@": WEB },
    // Everything (react, base-ui, cva, lucide…) lives in web/node_modules.
    nodePaths: [path.join(WEB, "node_modules")],
    define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
    loader: { ".woff2": "file", ".png": "file", ".svg": "file" },
    logLevel: "warning",
  });
}

/* ----------------------------------------------------------------- CSS */

async function bundleCss() {
  const { compile } = await fromWeb("@tailwindcss/node");
  const { Scanner } = await fromWeb("@tailwindcss/oxide");

  // Same import order the web app documents in app/globals.css.
  const webUrl = posix(WEB);
  const css = [
    `@import "${webUrl}/app/styles/grid-fonts.css";`,
    '@import "tailwindcss" source(none);',
    `@import "${webUrl}/app/styles/grid-tokens.css";`,
    `@import "${webUrl}/app/styles/grid.css";`,
    `@import "${webUrl}/app/styles/grid-tailwind.css";`,
    "@custom-variant dark (&:where(.dark, .dark *));",
    fs.readFileSync(path.join(DESKTOP, "src", "renderer", "theme.css"), "utf8"),
  ].join("\n");

  const compiler = await compile(css, { base: WEB, onDependency: () => {} });

  // Scan both the desktop renderer and the shadcn components it pulls in, or
  // their utility classes would be tree-shaken out of the stylesheet.
  const scanner = new Scanner({
    sources: [
      { base: path.join(DESKTOP, "src", "renderer"), pattern: "**/*.{ts,tsx,css}", negated: false },
      { base: path.join(WEB, "components", "ui"), pattern: "**/*.tsx", negated: false },
      { base: path.join(WEB, "lib"), pattern: "**/*.ts", negated: false },
    ],
  });

  let out = compiler.build(scanner.scan());

  // The generated @font-face rules point at ./fonts/*.woff2 relative to
  // web/app/styles; copy those next to the stylesheet and keep the URL.
  const fontsSrc = path.join(WEB, "app", "styles", "fonts");
  const fontsOut = path.join(OUT, "fonts");
  fs.mkdirSync(fontsOut, { recursive: true });
  for (const f of fs.readdirSync(fontsSrc)) {
    if (f.endsWith(".woff2")) fs.copyFileSync(path.join(fontsSrc, f), path.join(fontsOut, f));
  }

  fs.writeFileSync(path.join(OUT, "app.css"), out);
  return out.length;
}

/* --------------------------------------------------------------- assets */

function copyStatic() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(DESKTOP, "src", "renderer", "index.html"), path.join(OUT, "index.html"));
}

/* ----------------------------------------------------------------- run */

const dev = process.argv.includes("--dev");
fs.mkdirSync(OUT, { recursive: true });
copyStatic();
await bundleJs({ dev });
const cssBytes = await bundleCss();
const jsBytes = fs.statSync(path.join(OUT, "app.js")).size;
console.log(`renderer built -> out/renderer  (js ${(jsBytes / 1024).toFixed(0)} KB, css ${(cssBytes / 1024).toFixed(0)} KB)`);
