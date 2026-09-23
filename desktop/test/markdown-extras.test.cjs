// Unit tests for the renderer's pure markdown-extras pass (prepare.ts) and the
// opened-document helpers (document.ts). They are renderer modules (bundled by
// esbuild, not compiled by tsc), so the test bundles them on the fly with the
// desktop's own esbuild. No DOM needed.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

function load(rel) {
  const entry = path.join(__dirname, "..", "src", "renderer", rel);
  const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
  const m = new Module(entry);
  m._compile(out.outputFiles[0].text, entry);
  return m.exports;
}

const { prepareMarkdown, splitFences, extractMath } = load("features/markdown-extras/prepare.ts");
const { documentToNote, wordCount } = load("features/open-file/document.ts");

test("math: inline and display become placeholders; money and code stay", () => {
  const p = prepareMarkdown("Euler: $e^{i\\pi}+1=0$ costs $5 and $10.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n`$HOME` and \\$escaped$");
  assert.deepEqual(p.math, [
    { tex: "e^{i\\pi}+1=0", display: false },
    { tex: "\\int_0^1 x\\,dx", display: true },
  ]);
  assert.match(p.body, /Euler: ZKMATHI0ZK costs \$5 and \$10\./);
  assert.match(p.body, /\nZKMATHD1ZK\n/);
  assert.match(p.body, /`\$HOME` and \\\$escaped\$/);
});

test("math inside fenced code is untouched", () => {
  const p = prepareMarkdown("```sh\necho $A $B\n```\n\n$x$");
  assert.equal(p.math.length, 1);
  assert.match(p.body, /echo \$A \$B/);
});

test("mermaid fences become placeholder paragraphs", () => {
  const p = prepareMarkdown("Before\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nAfter");
  assert.deepEqual(p.mermaid, ["graph TD\n  A-->B"]);
  assert.match(p.body, /\n\nZKMERMAID0ZK\n\n/);
});

test("footnotes: definitions are pulled out, references stay", () => {
  const p = prepareMarkdown("Text[^1] and more[^note].\n\n[^1]: First.\n[^note]: Second\n    continued.\n\nEnd");
  assert.equal(p.footnotes.get("1"), "First.");
  assert.equal(p.footnotes.get("note"), "Second\ncontinued.");
  assert.match(p.body, /Text\[\^1\] and more\[\^note\]\./);
  assert.doesNotMatch(p.body, /\[\^1\]:/);
  assert.match(p.body, /End$/);
});

test("frontmatter is stripped and returned", () => {
  const p = prepareMarkdown("---\ntitle: Doc\ntags: [a]\n---\n# Hi");
  assert.deepEqual(p.frontmatter, { title: "Doc", tags: ["a"] });
  assert.equal(p.body, "# Hi");
});

test("fence splitting honours ~~~ and longer fences", () => {
  const segs = splitFences("a\n~~~~\n```\nnot closed by this\n~~~~\nb");
  assert.deepEqual(segs.map((s) => s.code), [false, true, false]);
  assert.equal(extractMath("a $b$ c", []), "a ZKMATHI0ZK c");
});

test("opened document -> note: title/tags/body rules", () => {
  assert.deepEqual(documentToNote("---\ntitle: T\ntags: x, y\n---\nbody", "f.md"), { title: "T", body: "body", tags: ["x", "y"] });
  assert.deepEqual(documentToNote("# Heading\n\ntext", "f.md"), { title: "Heading", body: "text", tags: [] });
  assert.deepEqual(documentToNote("intro\n# Later", "My File.markdown"), { title: "My File", body: "intro\n# Later", tags: [] });
  assert.equal(wordCount("Hello world — مرحبا بالعالم\n```\ncode here\n```"), 4);
});
