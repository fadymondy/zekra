import assert from "node:assert/strict";
import { test } from "node:test";

import { isLossy } from "../../../../web/components/notes/lossy-markdown.ts";
import { authImageUrl, chooseMode, fontStack, nextHeading, zekraVars } from "./engine-core.ts";
import { exportFilename, pngPixelRatio, safeFilename } from "./export-core.ts";

const API = "https://app.zekra.dev";

test("mode: read-only brains always render", () => {
  assert.equal(chooseMode({ editable: false, lossy: false, sourceRequested: true }), "rendered");
});

test("mode: lossy notes render until the user picks the markdown source", () => {
  const lossy = isLossy("Text[^1]\n\n[^1]: the footnote");
  assert.equal(lossy, true);
  assert.equal(chooseMode({ editable: true, lossy, sourceRequested: false }), "rendered");
  assert.equal(chooseMode({ editable: true, lossy, sourceRequested: true }), "source");
});

test("mode: ordinary notes open in the rich editor", () => {
  const md = "# Title\n\n- [ ] task\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```html\n<div>not a block</div>\n```";
  assert.equal(isLossy(md), false, "html inside a fence is an example, not a construct");
  assert.equal(chooseMode({ editable: true, lossy: isLossy(md), sourceRequested: false }), "rich");
  assert.equal(isLossy("<details>\n<summary>x</summary>\n</details>"), true);
});

test("heading cycle", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(nextHeading), [1, 2, 3, 0, 0]);
});

test("font stacks: system leads with Lusail, others mirror web", () => {
  assert.match(fontStack("system"), /^Lusail,/);
  assert.match(fontStack("reading"), /Iowan Old Style/);
  assert.match(fontStack("serif"), /^Georgia/);
});

test("zekra vars fill every variable the engine CSS reads", () => {
  const v = zekraVars({ bg: "#1", card: "#2", soft: "#3", line: "#4", ink: "#5", body: "#6", muted: "#7", action: "#8", gold: "#9", danger: "#a" }, "dark");
  for (const key of ["--grid-bg", "--grid-card", "--grid-soft", "--grid-fg", "--grid-muted", "--grid-line", "--grid-action", "--zk-code-bg", "--hl-keyword"]) {
    assert.ok(v[key], key);
  }
  assert.equal(v["--hl-keyword"], "#ff7b72");
});

test("auth images: only API paths on the API origin get the token", () => {
  assert.equal(authImageUrl("/api/notes/image/ns/abc.png", API), `${API}/api/notes/image/ns/abc.png`);
  assert.equal(authImageUrl(`${API}/api/notes/image/ns/abc.png`, `${API}/`), `${API}/api/notes/image/ns/abc.png`);
  assert.equal(authImageUrl("https://evil.example/api/notes/image/x.png", API), null);
  assert.equal(authImageUrl("https://app.zekra.dev.evil.example/api/x.png", API), null);
  assert.equal(authImageUrl("//evil.example/api/x.png", API), null);
  assert.equal(authImageUrl("/static/logo.png", API), null);
  assert.equal(authImageUrl("data:image/png;base64,AAA", API), null);
  assert.equal(authImageUrl("", API), null);
});

test("filenames", () => {
  assert.equal(safeFilename('a/b\\c:"d"*?'), "a-bc-d--");
  assert.equal(safeFilename("  "), "note");
  assert.equal(safeFilename("..hidden"), "hidden");
  assert.equal(safeFilename("line\nbreak\ttab"), "linebreaktab");
  assert.equal(safeFilename("ملاحظة: خطة الربع"), "ملاحظة- خطة الربع");
  assert.equal(Array.from(safeFilename("😀".repeat(100))).length, 80);
  assert.equal(exportFilename("Plan", "docx"), "Plan.docx");
});

test("png ratio stays under the canvas limit", () => {
  assert.equal(pngPixelRatio(720, 1000), 2);
  const r = pngPixelRatio(720, 20000);
  assert.ok(720 * r * 20000 * r <= 16_000_000);
  assert.equal(pngPixelRatio(0, 0), 1);
});
