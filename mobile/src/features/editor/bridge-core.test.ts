import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeFromEngine, decodeToEngine, encode, injectionFor, type FromEngine, type ToEngine } from "./bridge-core.ts";

/*
The bridge codec. Both sides trust a decoded message's shape, so the decoder
is the only thing standing between a stray/malformed postMessage and a handler
that assumes fields exist.
*/

test("round-trips every engine -> RN message", () => {
  const msgs: FromEngine[] = [
    { type: "ready" },
    { type: "change", markdown: "# hi\n\nمرحبا" },
    { type: "markdown", id: 3, markdown: "" },
    { type: "mode", mode: "rendered", lossy: ["footnote"] },
    { type: "height", height: 420 },
    { type: "pasteImage", dataUrl: "data:image/png;base64,AAAA", mime: "image/png", name: "pasted.png" },
    { type: "link", href: "https://zekra.dev" },
    { type: "imageRequest", src: "/api/notes/image/ns/abc.png" },
    { type: "exportResult", id: 1, ok: true, data: "UEsDB", encoding: "base64" },
    { type: "exportResult", id: 2, ok: false, error: "boom" },
  ];
  for (const msg of msgs) assert.deepEqual(decodeFromEngine(encode(msg)), msg);
});

test("round-trips RN -> engine messages", () => {
  const msgs: ToEngine[] = [
    { type: "setMarkdown", markdown: "x" },
    { type: "exec", command: "bold" },
    { type: "exec", command: "link", arg: "https://a.b" },
    { type: "insertImage", url: "/api/notes/image/n/1.png", alt: "" },
    { type: "export", id: 9, format: "docx", markdown: "# t", title: "T", themeId: null, dir: "auto" },
  ];
  for (const msg of msgs) assert.deepEqual(decodeToEngine(encode(msg)), msg);
});

test("rejects foreign, malformed and mis-shaped messages", () => {
  assert.equal(decodeFromEngine("not json"), null);
  assert.equal(decodeFromEngine(JSON.stringify({ type: "change", markdown: "x" })), null, "no wire mark");
  assert.equal(decodeFromEngine(JSON.stringify({ zk: 1, type: "nope" })), null, "unknown type");
  assert.equal(decodeFromEngine(JSON.stringify({ zk: 1, type: "change", markdown: 5 })), null, "wrong field type");
  assert.equal(decodeFromEngine(JSON.stringify({ zk: 1, type: "height", height: "12" })), null);
  assert.equal(decodeFromEngine(JSON.stringify({ zk: 1, type: "toString" })), null, "prototype keys are not types");
  assert.equal(decodeFromEngine(JSON.stringify([1, 2])), null);
  assert.equal(decodeFromEngine(null), null);
  // A to-engine message is not a valid from-engine one and vice versa.
  assert.equal(decodeFromEngine(encode({ type: "setMarkdown", markdown: "x" })), null);
  assert.equal(decodeToEngine(encode({ type: "change", markdown: "x" })), null);
});

test("injected script delivers content as data, never as code", () => {
  const nasty = `"); alert(1); ("</script><script>  \\'` + "`${x}`";
  const js = injectionFor({ type: "setMarkdown", markdown: nasty });
  let received: unknown;
  const window = { __zk: { receive: (raw: unknown) => (received = raw) } };
  // eslint-disable-next-line no-new-func
  new Function("window", js)(window);
  assert.deepEqual(decodeToEngine(received), { type: "setMarkdown", markdown: nasty });
});
