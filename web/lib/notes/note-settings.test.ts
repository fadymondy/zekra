import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  DEFAULT_SETTINGS,
  FONT_SIZE_RANGE,
  coerceSettings,
  fontStack,
  readerStyle,
} from "./note-settings.ts"

/*
Settings come out of localStorage, which is user-writable and may hold values
from an older build. These tests pin the coercion, because a bad value here
renders the reading pane unusable with no in-app way back.
*/

describe("coercion", () => {
  test("empty and garbage input fall back to defaults", () => {
    assert.deepEqual(coerceSettings(undefined), DEFAULT_SETTINGS)
    assert.deepEqual(coerceSettings(null), DEFAULT_SETTINGS)
    assert.deepEqual(coerceSettings("nonsense"), DEFAULT_SETTINGS)
    assert.deepEqual(coerceSettings(42), DEFAULT_SETTINGS)
  })

  test("font size is clamped to a legible range", () => {
    assert.equal(coerceSettings({ fontSize: 2 }).fontSize, FONT_SIZE_RANGE.min)
    assert.equal(coerceSettings({ fontSize: 900 }).fontSize, FONT_SIZE_RANGE.max)
    assert.equal(coerceSettings({ fontSize: 17 }).fontSize, 17)
  })

  test("non-numeric font size does not produce NaN", () => {
    const s = coerceSettings({ fontSize: "big" as unknown as number })
    assert.equal(s.fontSize, DEFAULT_SETTINGS.fontSize)
    assert.ok(Number.isFinite(s.fontSize))
  })

  test("an unknown font family falls back rather than breaking the stack", () => {
    assert.equal(coerceSettings({ fontFamily: "comic" as never }).fontFamily, "system")
  })

  test("an unknown autoSave mode falls back to off", () => {
    assert.equal(coerceSettings({ autoSave: "every-ms" as never }).autoSave, "off")
    assert.equal(coerceSettings({ autoSave: "blur" }).autoSave, "blur")
  })

  test("booleans are not coerced from truthy junk", () => {
    assert.equal(coerceSettings({ wordWrap: "yes" as never }).wordWrap, DEFAULT_SETTINGS.wordWrap)
  })

  test("an empty theme string means no theme, not a theme named ''", () => {
    assert.equal(coerceSettings({ theme: "" }).theme, null)
    assert.equal(coerceSettings({ theme: "dracula" }).theme, "dracula")
  })

  test("negative max width is clamped to unconstrained", () => {
    assert.equal(coerceSettings({ maxWidth: -100 }).maxWidth, 0)
  })
})

describe("reader style", () => {
  // The regression this guards: a reading-width cap was removed on explicit
  // request ("make the markdown full width"). Zero must stay unconstrained.
  test("max width 0 emits no maxWidth at all", () => {
    const style = readerStyle({ ...DEFAULT_SETTINGS, maxWidth: 0 })
    assert.equal(style.maxWidth, undefined)
  })

  test("the default is unconstrained", () => {
    assert.equal(DEFAULT_SETTINGS.maxWidth, 0)
    assert.equal(readerStyle(DEFAULT_SETTINGS).maxWidth, undefined)
  })

  test("a set max width is emitted in px", () => {
    assert.equal(readerStyle({ ...DEFAULT_SETTINGS, maxWidth: 760 }).maxWidth, "760px")
  })

  test("font size and family reach the style", () => {
    const style = readerStyle({ ...DEFAULT_SETTINGS, fontSize: 19, fontFamily: "serif" })
    assert.equal(style.fontSize, "19px")
    assert.match(style.fontFamily, /Georgia/)
  })

  test("every font family resolves to a real stack", () => {
    for (const id of ["system", "serif", "sans", "mono", "reading"] as const) {
      assert.ok(fontStack(id).length > 0)
    }
  })
})
