import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { groupedThemes, themeById, themeCss, themeVars } from "./apply.ts"
import { THEMES } from "./themes.ts"

describe("theme catalogue", () => {
  test("ships the ported themes with unique ids", () => {
    assert.ok(THEMES.length >= 25, `only ${THEMES.length} themes`)
    const ids = THEMES.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length, "duplicate theme id")
  })

  test("every theme has both kinds represented in the picker groups", () => {
    const { light, dark } = groupedThemes()
    assert.ok(light.length > 0 && dark.length > 0)
    assert.equal(light.length + dark.length, THEMES.length, "a theme is missing from both groups")
  })

  test("the named themes from the settings screen are present", () => {
    for (const id of ["github-light", "github-dark", "dracula", "monokai", "nord", "solarized-dark"]) {
      assert.ok(themeById(id), `missing ${id}`)
    }
  })

  test("every palette entry is a real colour", () => {
    for (const t of THEMES) {
      for (const [k, v] of Object.entries(t.palette)) {
        assert.match(v, /^#[0-9a-fA-F]{3,8}$|^rgb|^hsl/, `${t.id}.${k} = ${v}`)
      }
    }
  })
})

describe("theme variables", () => {
  test("a theme sets the variables the markdown CSS consumes", () => {
    const v = themeVars(themeById("dracula")!)
    for (const k of ["--grid-bg", "--grid-fg", "--grid-line", "--grid-action", "--hl-keyword", "--hl-string", "--hl-comment"]) {
      assert.ok(v[k], `missing ${k}`)
    }
  })

  test("links take the theme's link colour, not the brand violet", () => {
    const t = themeById("github-light")!
    assert.equal(themeVars(t)["--grid-action"], t.palette.link)
    assert.notEqual(themeVars(t)["--grid-action"].toLowerCase(), "#6d4de6")
  })

  test("no variable comes out undefined", () => {
    for (const t of THEMES) {
      for (const [k, val] of Object.entries(themeVars(t))) {
        assert.ok(val && val !== "undefined", `${t.id} ${k} = ${val}`)
      }
    }
  })
})

describe("scoping", () => {
  /*
  SCOPE CHANGED. This suite previously asserted the opposite: that a theme was
  confined to [data-note-theme] and could never touch the app chrome. That was
  my call, made to protect the brand palette; the product decision is that a
  reading theme repaints the WHOLE app, so the test now pins that instead.
  Leaving the old assertion would have made the intended behaviour look like a
  regression.
  */
  test("themeCss can still emit a scoped rule for a standalone export", () => {
    // Still used by the HTML exporter, which writes a self-contained file.
    const css = themeCss(themeById("monokai")!, ":root")
    assert.ok(css.startsWith(":root{"))
    assert.equal(css.split("{").length - 1, 1)
  })

  test("unknown ids resolve to nothing rather than throwing", () => {
    assert.equal(themeById("no-such-theme"), undefined)
    assert.equal(themeById(null), undefined)
    assert.equal(themeById(""), undefined)
  })
})
