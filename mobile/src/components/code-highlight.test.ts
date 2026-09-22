import assert from "node:assert/strict";
import { test } from "node:test";

import { highlight, resolveLanguage, tokenize, tokenColor } from "./code-highlight.ts";
import type { ThemePalette } from "../../../web/lib/markdown/themes/themes.ts";

/*
The hljs-HTML-to-tokens step (MH-319 item 1).

These tests exist because this module parses another library's output. That is
a reasonable choice — hljs's emitter API is internal and has changed across
major versions, while its markup has not — but it is only safe if the parsing
is pinned, especially entity decoding and nesting. A silent failure here
corrupts the text of a code block rather than just its colour.
*/

const palette: ThemePalette = {
  bg: "#fff", fg: "#000", fgMuted: "#888", border: "#ccc",
  link: "#00f", linkHover: "#009", codeBg: "#eee", inlineCodeBg: "#eee",
  tableStripe: "#f7f7f7", accent: "#f00",
};

const text = (tokens: { text: string }[]) => tokens.map((t) => t.text).join("");

test("plain text survives with no scope", () => {
  assert.deepEqual(tokenize("hello world"), [{ text: "hello world", scope: "" }]);
});

test("a span becomes a scoped run, stripped of the hljs- prefix", () => {
  const tokens = tokenize('<span class="hljs-keyword">const</span> x');
  assert.deepEqual(tokens, [
    { text: "const", scope: "keyword" },
    { text: " x", scope: "" },
  ]);
});

test("entities are decoded, so the code reads as written", () => {
  // The whole point of the round trip: hljs escapes, and if this did not
  // decode, a note full of generics would render as "&lt;T&gt;".
  const tokens = tokenize("a &lt; b &amp;&amp; c &gt; d &quot;e&quot; &#x27;f&#39;");
  assert.equal(text(tokens), `a < b && c > d "e" 'f'`);
});

test("nested scopes resolve to the innermost", () => {
  const tokens = tokenize('<span class="hljs-string">"a<span class="hljs-subst">b</span>c"</span>');
  assert.deepEqual(
    tokens.map((t) => [t.text, t.scope]),
    [['"a', "string"], ["b", "subst"], ['c"', "string"]],
  );
});

test("a class-less or language- span inherits rather than losing its colour", () => {
  const tokens = tokenize('<span class="hljs-string">a<span class="language-xml">b</span>c</span>');
  assert.deepEqual(new Set(tokens.map((t) => t.scope)), new Set(["string"]));
  assert.equal(text(tokens), "abc");
});

test("adjacent runs of the same scope are merged", () => {
  // Without this a decoded entity splits a word into three <Text> nodes, which
  // RN then lays out with visible seams.
  const tokens = tokenize("a&amp;b");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].text, "a&b");
});

test("highlighting never loses or reorders the source", () => {
  const code = 'const greet = (name: string) => `hi ${name}`; // <ok> & "done"';
  assert.equal(text(highlight(code, "ts")), code);
});

test("an unknown language falls back to one plain run", () => {
  const code = "whatever { this: is }";
  assert.deepEqual(highlight(code, "klingon"), [{ text: code, scope: "" }]);
});

test("fence aliases resolve to a registered grammar", () => {
  assert.equal(resolveLanguage("ts"), "typescript");
  assert.equal(resolveLanguage("TSX"), "typescript");
  assert.equal(resolveLanguage("sh"), "bash");
  assert.equal(resolveLanguage("yml"), "yaml");
  assert.equal(resolveLanguage("html"), "xml");
  assert.equal(resolveLanguage(""), "");
  assert.equal(resolveLanguage("klingon"), "");
});

test("colours come from the theme, and an unknown scope is body text", () => {
  assert.equal(tokenColor("comment", palette, "#body"), palette.fgMuted);
  assert.equal(tokenColor("string", palette, "#body"), palette.link);
  assert.equal(tokenColor("keyword", palette, "#body"), palette.accent);
  // Dotted scopes ("meta.prompt") bucket on their first segment.
  assert.equal(tokenColor("meta.prompt", palette, "#body"), palette.accent);
  assert.equal(tokenColor("", palette, "#body"), "#body");
  assert.equal(tokenColor("something-new", palette, "#body"), "#body");
});
