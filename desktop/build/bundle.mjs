// Zekra desktop renderer build.
//
// The renderer is a React app that uses the SAME shadcn components, tokens and
// fonts as the web console (web/components/ui, web/app/styles/grid-*), so the
// desktop app cannot drift from the web design system.
//
// React, the shadcn deps and the Tailwind toolchain are resolved out of
// web/node_modules (the renderer shares the web's component tree, so it must
// share its package versions too). esbuild is the desktop's own devDependency.
//
// Outputs:
//   out/renderer/{index.html,app.js,app.css,fonts/}  the renderer
//   out/main/preload.js                              the bundled preload
//   out/assets/trayTemplate*.png                     menubar icon
//
// Aliases (mirrored in tsconfig.renderer.json "paths"):
//   @/        -> ../web          shadcn components, web lib
//   @mobile/  -> ../mobile/src   shared pure-TS modules (i18n dictionaries)
// Files under mobile/src use "@/" for THEIR OWN root, so an import of "@/…"
// from a mobile file is resolved against mobile/src, not web (plugin below).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO = path.resolve(DESKTOP, "..");
const WEB = path.join(REPO, "web");
const MOBILE_SRC = path.join(REPO, "mobile", "src");
const OUT = path.join(DESKTOP, "out", "renderer");

const webRequire = createRequire(path.join(WEB, "package.json"));
const desktopRequire = createRequire(path.join(DESKTOP, "package.json"));
const esbuild = desktopRequire("esbuild");
const fromWeb = (id) => import(pathToFileURL(webRequire.resolve(id)).href);

const posix = (p) => p.split(path.sep).join("/");

/* ------------------------------------------------------------------ JS */

/** "@/x" imported FROM a mobile/src file means mobile/src/x. */
const mobileSelfAlias = {
  name: "mobile-self-alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      if (!args.importer.startsWith(MOBILE_SRC + path.sep)) return undefined;
      return build.resolve("./" + args.path.slice(2), { resolveDir: MOBILE_SRC, kind: args.kind });
    });
  },
};

async function bundleJs({ dev }) {
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
    alias: { "@": WEB, "@mobile": MOBILE_SRC },
    plugins: [mobileSelfAlias],
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

  // Reuse web/app/globals.css verbatim rather than restating its import order
  // here. It carries far more than imports: the @theme inline block that maps
  // --color-primary -> --primary (without it `bg-primary` is never generated
  // and every shadcn button renders transparent), the @layer base defaults,
  // and the :lang(ar) rules that keep Arabic out of mono and un-letter-spaced.
  // Duplicating that list is how the desktop silently drifts from the console.
  //
  // Two edits are needed to relocate it: its ./styles imports are relative to
  // web/app, and its @source roots are the web app's own trees — the desktop
  // scans its renderer instead, via the Scanner below.
  const webUrl = posix(WEB);
  const globals = fs
    .readFileSync(path.join(WEB, "app", "globals.css"), "utf8")
    .replace(/^\s*@source\s+[^;]+;\s*$/gm, "")
    .replace(/@import\s+"\.\/styles\//g, `@import "${webUrl}/app/styles/`);

  const css = [
    globals,
    fs.readFileSync(path.join(DESKTOP, "src", "renderer", "theme.css"), "utf8"),
    // MH-450 presentations: the web viewers' series palette + page styles
    // (the web imports it from the /p/[token] page, which the desktop has not).
    fs.readFileSync(path.join(WEB, "components", "presentations", "presentations.css"), "utf8"),
  ].join("\n");

  const compiler = await compile(css, { base: WEB, onDependency: () => {} });

  // Scan both the desktop renderer and the shadcn components it pulls in, or
  // their utility classes would be tree-shaken out of the stylesheet.
  const scanner = new Scanner({
    sources: [
      { base: path.join(DESKTOP, "src", "renderer"), pattern: "**/*.{ts,tsx,css}", negated: false },
      { base: path.join(WEB, "components", "notes"), pattern: "**/*.tsx", negated: false },
      { base: path.join(WEB, "components", "ui"), pattern: "**/*.tsx", negated: false },
      // MH-450 presentations: the web viewers the Presentations tab renders
      // (deck/report/page + scenes; not admin/, the web-only editor).
      { base: path.join(WEB, "components", "presentations"), pattern: "*.tsx", negated: false },
      { base: path.join(WEB, "components", "presentations", "scenes"), pattern: "*.tsx", negated: false },
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

/* -------------------------------------------------------------- preload */

// A sandboxed preload may only require("electron") and a few builtins, so the
// shared IPC contract has to be inlined rather than required at runtime.
async function bundlePreload({ dev }) {
  await esbuild.build({
    entryPoints: [path.join(DESKTOP, "src", "main", "preload.ts")],
    outfile: path.join(DESKTOP, "out", "main", "preload.js"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: ["node20"],
    external: ["electron"],
    sourcemap: dev ? "inline" : false,
    logLevel: "warning",
  });
}

/* --------------------------------------------------------------- assets */

/** The CSP lives in src/shared/csp.ts; evaluate it rather than restate it. */
async function loadCsp() {
  const src = fs.readFileSync(path.join(DESKTOP, "src", "shared", "csp.ts"), "utf8");
  const { code } = await esbuild.transform(src, { loader: "ts", format: "esm" });
  const mod = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  return mod.CSP;
}

async function copyStatic() {
  fs.mkdirSync(OUT, { recursive: true });
  const html = fs
    .readFileSync(path.join(DESKTOP, "src", "renderer", "index.html"), "utf8")
    .replace(`content="%CSP%"`, `content="${await loadCsp()}"`);
  fs.writeFileSync(path.join(OUT, "index.html"), html);

  // Menubar icon (generated by build/make-icons.mjs, committed in build/).
  const assets = path.join(DESKTOP, "out", "assets");
  fs.mkdirSync(assets, { recursive: true });
  for (const f of ["trayTemplate.png", "trayTemplate@2x.png"]) {
    const from = path.join(DESKTOP, "build", f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(assets, f));
  }
}

/* --------------------------------------------------------------- vendor */

// MH-450 markdown extras (src/renderer/features/markdown-extras): KaTeX and
// Mermaid are LAZY — copied here as their prebuilt browser builds and loaded
// with a <script> tag the first time a document needs them, so neither sits
// in app.js (mermaid alone is ~3 MB). Both are desktop devDependencies.
function copyVendor() {
  const vendor = path.join(OUT, "vendor");
  const nm = path.join(DESKTOP, "node_modules");
  const copy = (from, to) => {
    if (!fs.existsSync(from)) return console.warn(`[bundle] vendor asset missing: ${from}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  };
  copy(path.join(nm, "katex", "dist", "katex.min.js"), path.join(vendor, "katex", "katex.min.js"));
  copy(path.join(nm, "katex", "dist", "katex.min.css"), path.join(vendor, "katex", "katex.min.css"));
  const fonts = path.join(nm, "katex", "dist", "fonts");
  if (fs.existsSync(fonts)) {
    for (const f of fs.readdirSync(fonts)) {
      if (f.endsWith(".woff2")) copy(path.join(fonts, f), path.join(vendor, "katex", "fonts", f));
    }
  }
  copy(path.join(nm, "mermaid", "dist", "mermaid.min.js"), path.join(vendor, "mermaid", "mermaid.min.js"));
}

/* ----------------------------------------------------------------- run */

const dev = process.argv.includes("--dev");
fs.mkdirSync(OUT, { recursive: true });
await copyStatic();
copyVendor(); // MH-450 markdown extras (lazy KaTeX + Mermaid)
await bundlePreload({ dev });
await bundleJs({ dev });
const cssBytes = await bundleCss();
const jsBytes = fs.statSync(path.join(OUT, "app.js")).size;
console.log(`renderer built -> out/renderer  (js ${(jsBytes / 1024).toFixed(0)} KB, css ${(cssBytes / 1024).toFixed(0)} KB)`);
