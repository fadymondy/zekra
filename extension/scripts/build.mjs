// Build the store/unpacked bundle: copies only the runtime files into
// dist/zekra-extension-<version>/ (dropping the web-preview shim and dev docs)
// and zips it for the Chrome Web Store. No dependencies: `node scripts/build.mjs`.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const name = `zekra-extension-${manifest.version}`;
const distDir = join(root, "dist");
const out = join(distDir, name);
const zip = join(distDir, `${name}.zip`);

const FILES = [
  "manifest.json",
  "background.js",
  "api.js",
  "oauth.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "tokens.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "icons/mark.svg",
];

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });

for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) throw new Error(`missing ${f}`);
  mkdirSync(dirname(join(out, f)), { recursive: true });
  if (f.endsWith(".html")) {
    // The browser-preview shim is a dev aid only; the real extension never needs it.
    const html = readFileSync(src, "utf8").replace(/\s*<script src="browser-shim\.js"><\/script>/, "");
    writeFileSync(join(out, f), html);
  } else {
    cpSync(src, join(out, f));
  }
}

// Every file the manifest and pages reference must be in the bundle.
for (const f of FILES.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(out, f), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(join(out, ref))) throw new Error(`${f} references missing ${ref}`);
  }
}
for (const f of ["api.js", "oauth.js", "background.js", "popup.js", "options.js"]) {
  const js = readFileSync(join(out, f), "utf8");
  for (const [, ref] of js.matchAll(/from "\.\/([^"]+)"/g)) {
    if (!existsSync(join(out, ref))) throw new Error(`${f} imports missing ${ref}`);
  }
}

execFileSync("zip", ["-qr", "-X", zip, "."], { cwd: out });

const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
let total = 0;
for (const f of walk(out)) {
  const size = statSync(f).size;
  total += size;
  console.log(`${String(size).padStart(7)}  ${relative(out, f)}`);
}
console.log(`${String(total).padStart(7)}  total (unpacked)`);
console.log(`${String(statSync(zip).size).padStart(7)}  ${relative(root, zip)}`);
console.log(`\nLoad unpacked: ${out}`);
