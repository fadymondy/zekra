import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  ACCEPTED_IMAGE_TYPES,
  ImageUploadError,
  MAX_IMAGE_BYTES,
  imageFilesFrom,
  uploadNoteImage,
} from "./upload-image.ts"

/*
The upload client's job is to fail clearly before the network, and to agree
with the server's limits. These tests pin both — a drift between
MAX_IMAGE_BYTES here and maxNoteImageBytes in note_images.go would show up as
an opaque 413 rather than a useful message.
*/

/** Minimal File stand-in: Node has no DOM File in this context. */
function fakeFile(size: number, type: string, name = "x.png"): File {
  return { size, type, name } as File
}

describe("client-side validation", () => {
  test("agrees with the server's 8 MB limit", () => {
    assert.equal(MAX_IMAGE_BYTES, 8 << 20)
  })

  test("rejects an oversized file without a round trip", async () => {
    await assert.rejects(
      () => uploadNoteImage(fakeFile(MAX_IMAGE_BYTES + 1, "image/png"), "ns"),
      (e: Error) => e instanceof ImageUploadError && /larger than 8 MB/.test(e.message),
    )
  })

  test("rejects SVG with a reason, not a bare 415", async () => {
    await assert.rejects(
      () => uploadNoteImage(fakeFile(100, "image/svg+xml"), "ns"),
      (e: Error) => e instanceof ImageUploadError && /SVG/.test(e.message),
    )
  })

  test("rejects other unsupported types by name", async () => {
    await assert.rejects(
      () => uploadNoteImage(fakeFile(100, "application/pdf"), "ns"),
      (e: Error) => /application\/pdf/.test(e.message),
    )
  })

  test("refuses to upload without a brain", async () => {
    await assert.rejects(
      () => uploadNoteImage(fakeFile(100, "image/png"), ""),
      (e: Error) => /no brain selected/.test(e.message),
    )
  })

  test("accepts exactly the types the server sniffs for", () => {
    assert.deepEqual(ACCEPTED_IMAGE_TYPES, ["image/png", "image/jpeg", "image/webp"])
  })
})

describe("extracting images from a paste or drop", () => {
  const dt = (items: unknown[], files: unknown[] = []) =>
    ({ items, files } as unknown as DataTransfer)

  test("returns nothing for a null transfer", () => {
    assert.deepEqual(imageFilesFrom(null), [])
  })

  test("picks image files out of items", () => {
    const file = fakeFile(10, "image/png")
    const got = imageFilesFrom(dt([{ kind: "file", getAsFile: () => file }]))
    assert.deepEqual(got, [file])
  })

  test("ignores non-file items, so plain text paste is untouched", () => {
    const got = imageFilesFrom(dt([{ kind: "string", getAsFile: () => null }]))
    assert.deepEqual(got, [])
  })

  test("ignores non-image files, so a dropped PDF does not upload", () => {
    const pdf = fakeFile(10, "application/pdf", "a.pdf")
    const got = imageFilesFrom(dt([{ kind: "file", getAsFile: () => pdf }]))
    assert.deepEqual(got, [])
  })

  // Some browsers expose a screenshot only through .files, not .items.
  test("falls back to files when items yields nothing", () => {
    const file = fakeFile(10, "image/png")
    const got = imageFilesFrom(dt([], [file]))
    assert.deepEqual(got, [file])
  })

  test("survives a transfer with neither items nor files", () => {
    assert.deepEqual(imageFilesFrom({} as DataTransfer), [])
  })
})
