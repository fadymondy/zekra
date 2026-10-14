import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clock,
  countByKind,
  extOf,
  formatBytes,
  hasText,
  isBusy,
  itemInterval,
  listInterval,
  listQuery,
  localFileName,
  plainText,
  readText,
  statusTone,
  uploadPart,
} from "./media-core.ts";
import type { Media } from "./types.ts";

test("extOf reads the extension, ignoring query and path", () => {
  assert.equal(extOf("file:///a/b/Scan.JPG"), "jpg");
  assert.equal(extOf("https://x/y/doc.pdf?x=1#p"), "pdf");
  assert.equal(extOf("noext"), "");
  assert.equal(extOf(".hidden"), "");
});

test("uploadPart takes the picker type when the server reads it", () => {
  const r = uploadPart({ uri: "file:///c/IMG_1.jpg", name: "IMG_1.jpg", mimeType: "image/jpeg", size: 1000 });
  assert.deepEqual(r, { part: { uri: "file:///c/IMG_1.jpg", name: "IMG_1.jpg", type: "image/jpeg" }, kind: "image" });
});

test("uploadPart falls back to the extension and fixes a missing one", () => {
  const byExt = uploadPart({ uri: "file:///c/voice.m4a", mimeType: "application/octet-stream" });
  assert.ok("part" in byExt);
  assert.equal(byExt.part.type, "audio/mp4");
  assert.equal(byExt.kind, "audio");

  const noExt = uploadPart({ uri: "content://x/123", name: "Page", mimeType: "application/pdf" }, "file");
  assert.ok("part" in noExt);
  assert.equal(noExt.part.name, "Page.pdf");

  const unnamed = uploadPart({ uri: "content://x/", mimeType: "image/png" }, "photo");
  assert.ok("part" in unnamed);
  assert.equal(unnamed.part.name, "photo.png");
});

test("uploadPart keeps the alias type phones report", () => {
  const r = uploadPart({ uri: "file:///c/a.mov", name: "a.mov", mimeType: "video/quicktime" });
  assert.ok("part" in r);
  assert.equal(r.kind, "video");
});

test("uploadPart rejects unsupported types and oversized files", () => {
  assert.deepEqual(uploadPart({ uri: "file:///c/a.heic", name: "a.heic", mimeType: "image/heic" }), { error: "type" });
  assert.deepEqual(uploadPart({ uri: "file:///c/a.docx", name: "a.docx" }), { error: "type" });
  assert.deepEqual(uploadPart({ uri: "file:///c/big.png", name: "big.png", size: 41 * 1024 * 1024 }), { error: "size", kind: "image" });
  assert.ok("part" in uploadPart({ uri: "file:///c/ok.pdf", name: "ok.pdf", size: 199 * 1024 * 1024 }));
});

test("status helpers", () => {
  assert.equal(isBusy("pending"), true);
  assert.equal(isBusy("processing"), true);
  assert.equal(isBusy("done"), false);
  assert.equal(statusTone("done"), "ok");
  assert.equal(statusTone("failed"), "danger");
  assert.equal(statusTone("processing"), "warn");
  assert.equal(statusTone("weird"), "muted");
});

test("polling is fast only while something is being read", () => {
  assert.equal(listInterval([{ status: "done" }, { status: "pending" }]), 3_000);
  assert.equal(listInterval([{ status: "done" }]), 30_000);
  assert.equal(listInterval(undefined), 30_000);
  assert.equal(itemInterval({ status: "processing" }), 2_500);
  assert.equal(itemInterval({ status: "failed" }), false);
  assert.equal(itemInterval(undefined), false);
});

test("countByKind ignores unknown kinds", () => {
  const items = [{ kind: "image" }, { kind: "image" }, { kind: "pdf" }, { kind: "x" }] as Pick<Media, "kind">[];
  assert.deepEqual(countByKind(items), { image: 2, pdf: 1, video: 0, audio: 0 });
});

test("readText splits an image into its lines", () => {
  const m = {
    kind: "image" as const,
    result: {
      segments: [
        {
          kind: "image" as const,
          text: "مرحبا\nHello",
          lines: [
            { text: "مرحبا", score: 0.9, box: [] as [number, number][], script: "arabic" },
            { text: " ", score: 0.1, box: [] as [number, number][] },
            { text: "Hello", score: 0.95, box: [] as [number, number][] },
          ],
        },
      ],
    },
  };
  const r = readText(m);
  assert.deepEqual(r.lines.map((l) => l.text), ["مرحبا", "Hello"]);
  assert.equal(r.text.length, 0);
  assert.equal(plainText(r), "مرحبا\nHello");
});

test("readText splits a video into on-screen text and speech", () => {
  const r = readText({
    kind: "video",
    result: {
      duration: 90,
      segments: [
        { kind: "frame", start: 0, text: "Title slide" },
        { kind: "frame", start: 10, text: "  " },
        { kind: "speech", start: 1, end: 4, text: "Welcome everyone" },
      ],
    },
  });
  assert.deepEqual(r.text.map((s) => s.text), ["Title slide"]);
  assert.deepEqual(r.speech.map((s) => s.text), ["Welcome everyone"]);
  assert.equal(hasText(r), true);
  assert.equal(plainText(r), "Title slide\nWelcome everyone");
});

test("readText with nothing read", () => {
  const r = readText({ kind: "pdf", result: undefined });
  assert.equal(hasText(r), false);
  assert.equal(plainText(r), "");
});

test("formatting", () => {
  assert.equal(clock(75), "1:15");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(clock(-3), "0:00");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("listQuery adds the kind only when filtering", () => {
  assert.equal(listQuery("zekra", "all"), "namespace=zekra&limit=120");
  assert.equal(listQuery("my brain", "pdf", 50), "namespace=my+brain&limit=50&kind=pdf");
});

test("localFileName keeps the name safe for the cache", () => {
  assert.equal(localFileName({ id: "m1", name: "a/b:c?.pdf" }), "a_b_c_.pdf");
  assert.equal(localFileName({ id: "m1", name: "  " }), "media-m1");
});
