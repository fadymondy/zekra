import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBlocks, type Block } from "./markdown-blocks.ts";

/*
Pipe-table parsing for the mobile renderer (MH-319).

Run with the repo's node --test runner; this file is deliberately free of React
so it needs no RN environment — parseBlocks is pure.

The delimiter pattern gets its own tests because a wrong one is silent and
catastrophic: an over-permissive regex swallows the paragraph AFTER any line
containing a pipe, and the note simply loses text with no error anywhere.
*/

function only(md: string): Block {
  const blocks = parseBlocks(md);
  assert.equal(blocks.length, 1, `expected one block, got ${JSON.stringify(blocks)}`);
  return blocks[0];
}

/** Assert the block kind and narrow to it, so the assertions below are typed. */
function as<K extends Block["kind"]>(block: Block, kind: K): Extract<Block, { kind: K }> {
  assert.equal(block.kind, kind);
  return block as Extract<Block, { kind: K }>;
}

test("parses a table with outer pipes", () => {
  const block = only("| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Grace | Admiral |");
  assert.equal(block.kind, "table");
  assert.deepEqual(block.header, ["Name", "Role"]);
  assert.deepEqual(block.rows, [["Ada", "Engineer"], ["Grace", "Admiral"]]);
});

test("parses a table without outer pipes, and with alignment markers", () => {
  const block = only("Name | Role\n:--- | ---:\nAda | Engineer");
  assert.equal(block.kind, "table");
  // Outer pipes are optional in GFM; their absence must not produce empty cells.
  assert.deepEqual(block.header, ["Name", "Role"]);
  assert.deepEqual(block.rows, [["Ada", "Engineer"]]);
});

test("a ragged row is padded, and an over-long one trimmed, to the header width", () => {
  const block = only("| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |");
  assert.equal(block.kind, "table");
  // A ragged row is legal markdown; letting it through would shift later columns.
  assert.deepEqual(block.rows, [["1", "", ""], ["1", "2", "3"]]);
});

test("keeps an escaped pipe inside a cell", () => {
  const block = only("| expr | means |\n|---|---|\n| a \\| b | or |");
  assert.equal(block.kind, "table");
  assert.deepEqual(block.rows, [["a | b", "or"]]);
});

test("inline markup inside a cell is left for the inline renderer", () => {
  const block = only("| a |\n|---|\n| **bold** and `code` |");
  assert.equal(block.kind, "table");
  // Not pre-stripped: the cell is rendered through <Inline>, same as a paragraph.
  assert.deepEqual(block.rows, [["**bold** and `code`"]]);
});

test("a paragraph containing a pipe is NOT a table", () => {
  // The regression that matters: recognition requires a delimiter LINE, so
  // prose with a pipe in it stays prose and the line after it survives.
  const blocks = parseBlocks("use a | b to pipe\nand this line must survive");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["paragraph", "paragraph"],
  );
  assert.equal(as(blocks[1], "paragraph").text, "and this line must survive");
});

test("a horizontal rule after a pipe line is still a rule", () => {
  // "---" alone matches a one-column delimiter, so ordering here is load-bearing.
  const blocks = parseBlocks("a | b\n\n---\ntail");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["paragraph", "rule", "paragraph"],
  );
});

test("the table ends at a blank line", () => {
  const blocks = parseBlocks("| a |\n|---|\n| 1 |\n\nafter");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["table", "paragraph"],
  );
  assert.equal(as(blocks[1], "paragraph").text, "after");
});

test("a fenced block containing a pipe table is left as code", () => {
  const block = as(only("```\n| a |\n|---|\n```"), "code");
  assert.deepEqual(block.lines, ["| a |", "|---|"]);
});

// --- fence info (MH-319 item 1) --------------------------------------------

test("a fence names a language and, optionally, a file", () => {
  const plain = as(only("```\nx\n```"), "code");
  assert.deepEqual([plain.lang, plain.label], ["", ""]);

  const lang = as(only("```ts\nx\n```"), "code");
  assert.deepEqual([lang.lang, lang.label], ["ts", "ts"]);

  const named = as(only("```ts utils/date.ts\nx\n```"), "code");
  // The filename wins the label; the language still drives future highlighting.
  assert.deepEqual([named.lang, named.label], ["ts", "utils/date.ts"]);
});

test("an unknown fence language is a caption, not an error", () => {
  // Deliberately not validated against a language list: a caption that renders
  // is better than a block that refuses to.
  const block = as(only("```not-a-language\nx\n```"), "code");
  assert.deepEqual([block.lang, block.label], ["not-a-language", "not-a-language"]);
});

test("fence info is case-folded for the language but not the label", () => {
  const block = as(only("```TS README.md\nx\n```"), "code");
  assert.deepEqual([block.lang, block.label], ["ts", "README.md"]);
});
