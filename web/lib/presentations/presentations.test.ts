/*
Presentations renderers and guards (FM-343/344/345/346).

Run: npm test (node --test, native TypeScript stripping).
*/
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { inflateRawSync } from "node:zlib"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { INTERACTIVE_PLACEHOLDER, chartSVG, deckPrintHTML, esc, niceMax, reportPrintHTML, safeSrc } from "./export-html.ts"
import { reportDocx } from "./export-docx.ts"
import { markdownToHtml } from "./md-html.ts"
import { CANVAS_SCENES, COLOR_TOKENS, IFRAME_SCENES, THREE_SCENES, int, num, strings, token, tokens } from "./scene-params.ts"
import {
  CODE_SCENE_ASPECTS,
  CODE_SCENE_CSP,
  CODE_SCENE_READY,
  CODE_SCENE_SANDBOX,
  SHARE_PAGE_CSP,
  aspectRatio,
  codeSceneDocument,
  codeSceneFrameProps,
  isReadyMessage,
} from "./code-scene.ts"
import { ITEM_TEMPLATES, move, starter } from "./templates.ts"
import type { ChartBlock, DeckContent, PageContent, ReportContent } from "./types.ts"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..", "..")
// Where the Go presentations package lives in this repo. The cross-checks against it skip
// until it exists (the backend is ported separately).
const GO_CANDIDATES = [
  join(root, "plugins", "brain", "presentations"),
  join(root, "plugins", "brain", "internal", "presentations"),
  join(root, "plugins", "brain", "internal", "brain", "presentations"),
  join(root, "plugins", "presentations"),
  join(root, "plugins", "presentations", "internal", "presentations"),
  join(root, "internal", "presentations"),
]
const goDir = GO_CANDIDATES.find((d) => existsSync(join(d, "schema.go")))
const needsGo = { skip: goDir ? false : "Go presentations package not found in this repo" }
const goFile = (name: string) => readFileSync(join(goDir!, name), "utf8")
// The validator's fixtures: the Go package's testdata when it is here, else the web's copies.
const fixture = <T,>(kind: string) =>
  JSON.parse(readFileSync(join(goDir ? join(goDir, "testdata") : join(here, "testdata"), `${kind}.json`), "utf8")) as T
const doc = (locale: "en" | "ar") => ({ locale, title: "T", customer: "Sara", company: "Acme", fontCss: "", origin: "https://site.test" })

test("a deck prints one page per slide, every type, without notes", () => {
  const deck = fixture<DeckContent>("deck")
  const page = fixture<PageContent>("page")
  deck.slides.push({ type: "embed", title: "Concept", document_id: "p1" })
  const html = deckPrintHTML(deck, doc("en"), markdownToHtml, { p1: { content: page } })
  assert.equal(html.match(/<section class="slide /g)?.length, deck.slides.length)
  for (const type of ["title", "bullets", "metric", "two_column", "quote", "code", "image", "embed"]) {
    assert.ok(html.includes(`slide-${type}`), `no ${type} slide`)
  }
  assert.ok(!html.includes("outage from March"), "speaker notes reached the PDF")
  assert.ok(html.includes("Acme Track"), "the embedded page preview is missing")
  assert.ok(html.includes('src="https://site.test/brand/og.png"'), "site paths resolve against the origin")
  assert.ok(html.includes("@page { size: 297mm 167.06mm"), "slides are 16:9 pages")
  assert.ok(html.includes(`<bdi>${deck.slides.length} / ${deck.slides.length}</bdi>`))
})

test("print HTML escapes everything and drops unsafe sources", () => {
  const deck: DeckContent = {
    title: "<script>alert(1)</script>",
    slides: [
      { type: "bullets", title: "\"><img src=x onerror=alert(1)>", bullets: ["<b>x</b>"] },
      { type: "image", image_url: "javascript:alert(1)", alt: "a\" onload=\"x" },
      { type: "code", code: "</code><script>x</script>" },
    ],
  }
  const html = deckPrintHTML(deck, doc("en"), markdownToHtml)
  assert.ok(!/<script>alert|<img src=x|<b>x<\/b>|<script>x/.test(html), html)
  assert.ok(!html.includes("javascript:"))
  assert.equal(safeSrc("//evil.test/x", "https://o"), "")
  assert.equal(safeSrc("data:image/png;base64,x", "https://o"), "")
  assert.equal(esc(`<&"'>`), "&lt;&amp;&quot;&#39;&gt;")
})

test("markdown for print drops raw HTML and unsafe links", () => {
  const out = markdownToHtml("**bold** [ok](https://a.test) [bad](javascript:alert(1)) <script>x</script> <img src=x onerror=y>\n\n| a | b |\n|---|---|\n| 1 | 2 |")
  assert.ok(out.includes("<strong>bold</strong>"))
  assert.ok(out.includes('href="https://a.test"'))
  assert.ok(!out.includes("javascript:"))
  assert.ok(!out.includes("<script") && !out.includes("onerror"))
  assert.ok(out.includes("<table>"), "GFM tables render")
})

test("a report prints in order with every chart as SVG plus its table, RTL in Arabic", () => {
  const report = fixture<ReportContent>("report")
  const labels = { preparedFor: "Prepared for", summary: "Summary" }
  const en = reportPrintHTML(report, doc("en"), markdownToHtml, labels)
  assert.equal(en.match(/<svg /g)?.length, 2)
  assert.equal(en.match(/<table class="data">/g)?.length, 2, "every chart carries a data table")
  assert.ok(en.indexOf("Performance") < en.indexOf("Costs"))
  assert.ok(en.includes('class="callout warning"') && en.includes('class="callout success"'))
  assert.ok(en.includes('<html lang="en" dir="ltr">'))
  assert.ok(en.includes('class="legend"'), "two series get a legend")
  const ar = reportPrintHTML({ ...report, title: "تدقيق المنصة" }, doc("ar"), markdownToHtml, labels)
  assert.ok(ar.includes('<html lang="ar" dir="rtl">'))
  assert.ok(ar.includes("تدقيق المنصة"))
})

test("chart geometry: one axis with a clean maximum, thin bars, stacked sums", () => {
  assert.equal(niceMax(1800), 2000)
  assert.equal(niceMax(4.3), 5)
  assert.equal(niceMax(0), 1)
  const bar: ChartBlock = { type: "chart", chart: "bar", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] }
  const svg = chartSVG(bar, "en")
  for (const m of svg.matchAll(/<rect [^>]*width="([\d.]+)"/g)) assert.ok(Number(m[1]) <= 24, "bars are at most 24px")
  assert.ok(svg.includes(">2<"), "axis tops out at a clean 2")
  const stacked = chartSVG({ ...bar, chart: "stacked_bar", series: [{ name: "a", values: [3, 3] }, { name: "b", values: [4, 4] }] }, "en")
  assert.ok(stacked.includes(">10<"), "stacked axis covers the total (7 → 10)")
  const line = chartSVG({ ...bar, chart: "line" }, "ar")
  assert.ok(line.includes("<polyline") && line.includes("<circle"), "lines carry an end marker")
  assert.ok(!line.includes("<rect"))
})

function zipEntry(buf: Buffer, name: string): string {
  // Minimal reader: walk local file headers.
  let i = 0
  while (i < buf.length - 30 && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const size = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extra = buf.readUInt16LE(i + 28)
    const entry = buf.toString("utf8", i + 30, i + 30 + nameLen)
    const start = i + 30 + nameLen + extra
    if (entry === name) {
      const data = buf.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8")
    }
    i = start + size
  }
  throw new Error(`${name} not found (or sizes are in a data descriptor)`)
}

test("the Word report is a real docx, right-to-left in Arabic", async () => {
  const report = fixture<ReportContent>("report")
  const labels = { preparedFor: "أُعدّ لـ", summary: "الملخص", data: "البيانات" }
  const ar = await reportDocx({ ...report, title: "تدقيق المنصة" }, { locale: "ar", customer: "سارة", company: "أكمي" }, labels)
  assert.equal(ar.subarray(0, 2).toString(), "PK")
  const xml = zipEntry(ar, "word/document.xml")
  assert.ok(xml.includes("<w:bidi"), "paragraphs are bidi")
  assert.ok((xml.match(/<w:rtl\/>/g)?.length ?? 0) > 20, "runs are right-to-left")
  assert.ok(xml.includes("<w:bidiVisual"), "tables are right-to-left")
  assert.ok(xml.includes("تدقيق المنصة") && xml.includes("أُعدّ لـ: سارة · أكمي"))
  assert.ok(xml.includes("1,800") || xml.includes("١٬٨٠٠"), "chart values become a table")
  const en = zipEntry(await reportDocx(report, { locale: "en", customer: "Sara", company: "Acme" }, { ...labels, preparedFor: "Prepared for" }), "word/document.xml")
  assert.ok(!en.includes("<w:bidi/>") && !en.includes("<w:rtl/>"))
  assert.ok(en.includes("stable but slow"), "markdown emphasis keeps its text")
})

test("scene params are clamped and colours are tokens only", () => {
  assert.equal(int({ count: 1e9 }, "count", 100, 5000, 1500), 5000)
  assert.equal(num({ speed: "fast" }, "speed", 0, 3, 0.6), 0.6)
  assert.equal(num({ speed: Number.NaN }, "speed", 0, 3, 0.6), 0.6)
  assert.equal(token({ color: "#ff0000" }, "color", "brand"), "brand")
  assert.equal(token({ color: "chart-3" }, "color", "brand"), "chart-3")
  assert.deepEqual(tokens({ colors: ["brand", "red", "accent"] }, "colors", ["x", "y"]), ["brand", "accent"])
  assert.deepEqual(tokens({ colors: ["red"] }, "colors", ["brand", "accent"]), ["brand", "accent"])
  assert.deepEqual(strings({ labels: ["a".repeat(50), 3, "b"] }, "labels", 8, 40), ["a".repeat(40), "b"])
})

test("the web renders exactly the scene types and colour tokens the API accepts", needsGo, () => {
  const go = goFile("scenes.go")
  const goTypes = [...go.matchAll(/Type: "([a-z_]+)", Engine: "(three|canvas|iframe)"/g)].map((m) => `${m[2]}:${m[1]}`).sort()
  const web = [
    ...THREE_SCENES.map((t) => `three:${t}`),
    ...CANVAS_SCENES.map((t) => `canvas:${t}`),
    ...IFRAME_SCENES.map((t) => `iframe:${t}`),
  ].sort()
  assert.deepEqual(web, goTypes)
  const goTokens = /var ColorTokens = \[\]string\{([^}]*)\}/.exec(go)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1))
  assert.deepEqual([...COLOR_TOKENS], goTokens)
})

test("editor templates cover every type the API accepts", needsGo, () => {
  const go = goFile("schema.go")
  const block = (name: string) => new RegExp(`var ${name} = map\\[string\\]\\[\\]fieldSpec\\{([\\s\\S]*?)\\n\\}`).exec(go)?.[1] ?? ""
  const keys = (src: string) => [...src.matchAll(/^\t"([a-z_]+)":/gm)].map((m) => m[1]).sort()
  assert.deepEqual(Object.keys(ITEM_TEMPLATES.deck).sort(), keys(block("slideVariants")))
  assert.deepEqual(Object.keys(ITEM_TEMPLATES.report).sort(), keys(block("reportBlocks")))
  assert.deepEqual(Object.keys(ITEM_TEMPLATES.page).sort(), keys(block("pageSections")))
  assert.deepEqual(move([1, 2, 3], 0, 2), [2, 3, 1])
  assert.deepEqual(move([1, 2, 3], 0, 5), [1, 2, 3])
  assert.equal((starter("deck", "X") as { slides: unknown[] }).slides.length, 1)
})

test("every presentations string exists in English and Arabic", () => {
  const en = JSON.parse(readFileSync(join(here, "..", "..", "lang", "presentations.en.json"), "utf8")) as Record<string, string>
  const ar = JSON.parse(readFileSync(join(here, "..", "..", "lang", "presentations.ar.json"), "utf8")) as Record<string, string>
  const dynamic = [
    ...["deck", "report", "page"].map((k) => `presentations.kind.${k}`),
    ...["deck", "report", "page"].map((k) => `presentations.items.${k}`),
    ...["draft", "ready", "archived"].map((k) => `presentations.status.${k}`),
    ...["minimal", "bold", "editorial", "tech-dark"].map((k) => `presentations.styleName.${k}`),
    ...Object.values(ITEM_TEMPLATES).flatMap((m) => Object.keys(m)).map((k) => `presentations.type.${k}`),
    "presentations.format.pdf",
    "presentations.format.docx",
    "presentations.locale.en",
    "presentations.locale.ar",
    ...["step", "decision", "human_review", "system", "output"].map((k) => `presentations.workflow.kind.${k}`),
  ]
  const sources = [
    "components/presentations/deck-viewer.tsx",
    "components/presentations/report-chart.tsx",
    "components/presentations/page-preview.tsx",
    "components/presentations/shared-frame.tsx",
    "components/presentations/shared-view.tsx",
    "components/presentations/admin/presentations-list.tsx",
    "components/presentations/admin/presentation-editor.tsx",
    "app/[locale]/p/[token]/page.tsx",
    "app/[locale]/p/[token]/embed/[id]/page.tsx",
    "components/presentations/slide.tsx",
    "components/presentations/workflow-view.tsx",
    "components/presentations/screen-view.tsx",
    "components/presentations/embed-preview.tsx",
    "components/presentations/pres-theme.tsx",
    "lib/presentations/export-server.ts",
  ]
  const used = new Set(dynamic)
  for (const f of sources) {
    for (const m of readFileSync(join(here, "..", "..", f), "utf8").matchAll(/"(presentations\.[A-Za-z.]+[A-Za-z])"/g)) used.add(m[1])
  }
  assert.ok(used.size > 100, `only ${used.size} keys found — did the scan break?`)
  for (const key of used) {
    assert.ok(en[key], `en is missing ${key}`)
    assert.ok(ar[key], `ar is missing ${key}`)
  }
})

// ---- FM-346 code scenes -----------------------------------------------------------

const webRoot = join(here, "..", "..")
const goCode = () => goFile("code_scene.go").replace(/\r/g, "")

test("the code scene frame is sandboxed to allow-scripts and nothing else", () => {
  assert.equal(CODE_SCENE_SANDBOX, "allow-scripts")
  const props = codeSceneFrameProps("Demo")
  assert.equal(props.sandbox, "allow-scripts")
  assert.equal(props.loading, "lazy")
  assert.ok(!/allow-same-origin|allow-forms|allow-popups|allow-top-navigation|allow-modals/.test(JSON.stringify(props)))

  // The one iframe in the renderer takes its attributes from codeSceneFrameProps and overrides none of them.
  const tsx = readFileSync(join(webRoot, "components", "presentations", "scenes", "code-scene.tsx"), "utf8")
  const frames = tsx.match(/<iframe[\s\S]*?\/>/g) ?? []
  assert.equal(frames.length, 1)
  assert.match(frames[0], /\{\.\.\.codeSceneFrameProps\(label\)\}/)
  assert.match(frames[0], /srcDoc=\{srcDoc\}/)
  assert.doesNotMatch(frames[0], /\bsandbox=|\bsrc=|allow=/)

  // Nowhere in the presentations UI may a frame get same-origin powers.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
  for (const dir of [join(webRoot, "components", "presentations"), join(webRoot, "lib", "presentations"), join(webRoot, "app", "[locale]", "p")]) {
    for (const f of walk(dir).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"))) {
      const src = readFileSync(f, "utf8")
      assert.ok(!src.includes("allow-same-origin") || f.endsWith("code-scene.ts"), `${f} mentions allow-same-origin`)
      if (f.endsWith(".tsx") && !f.endsWith("code-scene.tsx")) assert.ok(!/<iframe\s/.test(src), `${f} renders an iframe outside code-scene.tsx`)
    }
  }
})

test("the code scene document carries the CSP first, and the Go copy matches", () => {
  const html = codeSceneDocument('<canvas></canvas><script>1</script>', { nonce: 'n"1<x', colorScheme: "dark", dir: "rtl" })
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)
  assert.ok(csp, "CSP meta missing")
  assert.equal(csp[1], CODE_SCENE_CSP)
  // Before anything the model wrote, and before any script.
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"))
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<canvas"))
  assert.ok(html.indexOf("<head>") < html.indexOf("Content-Security-Policy"))
  for (const d of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"]) assert.ok(CODE_SCENE_CSP.includes(d), d)
  assert.ok(!/unsafe-eval|'self'|\*/.test(CODE_SCENE_CSP))
  assert.match(html, /dir="rtl"/)
  assert.match(html, /color-scheme:dark/)
  assert.match(html, /<html[^>]* data-theme="dark"/)
  // The nonce cannot break out of the ready script.
  assert.match(html, /nonce:"n1x"/)

  assert.equal(aspectRatio("4:3"), "4 / 3")
  assert.equal(aspectRatio("9:16"), "16 / 9")
  // The Go copy (CSP, aspects, pinned three.js) is checked once the Go package is in this repo.
  if (!goDir) return
  const go = goCode()
  const goCsp = /const CodeSceneCSP = ([\s\S]*?)\n\n/.exec(go)?.[1].match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)).join("")
  assert.equal(goCsp, CODE_SCENE_CSP)
  const goAspects = /var CodeSceneAspects = \[\]string\{([^}]*)\}/.exec(go)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1))
  assert.deepEqual([...CODE_SCENE_ASPECTS], goAspects)
  // The pinned three.js is the one the site ships.
  const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> }
  assert.equal(pkg.dependencies.three.replace(/^\^|~/, ""), /const ThreeVersion = "([^"]+)"/.exec(go)?.[1])
})

test("the parent accepts only its own frame's ready ping", () => {
  const frame = {}
  const ok = { type: CODE_SCENE_READY, nonce: "abc" }
  assert.equal(isReadyMessage({ source: frame, data: ok }, frame, "abc"), true)
  assert.equal(isReadyMessage({ source: {}, data: ok }, frame, "abc"), false)
  assert.equal(isReadyMessage({ source: null, data: ok }, null, "abc"), false)
  assert.equal(isReadyMessage({ source: frame, data: { ...ok, nonce: "x" } }, frame, "abc"), false)
  assert.equal(isReadyMessage({ source: frame, data: "fm-code-scene-ready" }, frame, "abc"), false)
})

test("exports show a placeholder for a code scene", () => {
  const deck = fixture<DeckContent>("deck")
  const page = fixture<PageContent>("page")
  deck.slides = [{ type: "embed", title: "Concept", document_id: "p1" }]
  const plain = deckPrintHTML(deck, doc("en"), markdownToHtml, { p1: { content: page } })
  assert.ok(!plain.includes(INTERACTIVE_PLACEHOLDER.en))
  const scene = page.sections.find((s) => s.type === "scene")
  assert.ok(scene && scene.type === "scene")
  scene.scene = { type: "code", params: { html: "<script>alert(1)</script>", aspect: "16:9" } }
  for (const locale of ["en", "ar"] as const) {
    const html = deckPrintHTML(deck, doc(locale), markdownToHtml, { p1: { content: page } })
    assert.ok(html.includes(INTERACTIVE_PLACEHOLDER[locale]), locale)
    assert.ok(!html.includes("alert(1)"), "scene code reached the PDF")
  }
})

test("share pages allow same-origin frames only, and do not starve the scene frame", () => {
  const d = Object.fromEntries(SHARE_PAGE_CSP.split(";").map((p) => p.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]))
  assert.equal(d["frame-src"], "'self'")
  assert.equal(d["child-src"], "'self'")
  assert.equal(d["frame-ancestors"], "'none'")
  assert.equal(d["object-src"], "'none'")
  // Inherited by srcdoc in Chrome: these would break a legitimate scene.
  for (const k of ["default-src", "script-src", "style-src", "img-src", "font-src"]) assert.equal(d[k], undefined, k)
  const proxy = readFileSync(join(webRoot, "proxy.ts"), "utf8")
  assert.match(proxy, /if \(restPath\.startsWith\("\/p\/"\)\) \{\s*response\.headers\.set\("Content-Security-Policy", SHARE_PAGE_CSP\)/)
})

// ---- FM-341 polish / FM-350 --------------------------------------------------------

import { ICON_NAMES } from "./icon-names.ts"
import { embedShotHTML, screenHTML, workflowSVG } from "./export-blocks.ts"
import { connector, rowsFor, seriesDrawOrder, workflowEdges } from "./workflow.ts"
import type { ScreenBlock, WorkflowBlock } from "./types.ts"

const stubIcon = (name?: string) => (name ? `<svg viewBox="0 0 24 24"><path data-icon="${name}" d="M0 0"/></svg>` : "")

const wf = (): WorkflowBlock => ({
  type: "workflow",
  title: "Flow",
  steps: [
    { id: "a", title: "Order", icon: "shopping-cart", owner: "Sales" },
    { id: "b", title: "Check", kind: "decision" },
    { id: "c", title: "Ship <now>", kind: "output" },
  ],
  highlight: "b",
})

test("icons: the web maps exactly the names the API accepts", needsGo, () => {
  const go = goFile("icon_names.go")
  const goNames = [...go.matchAll(/^\t"([a-z0-9-]+)",$/gm)].map((m) => m[1])
  assert.ok(goNames.length >= 150)
  assert.deepEqual([...ICON_NAMES], goNames)
  const tsx = readFileSync(join(webRoot, "components", "presentations", "icon.tsx"), "utf8")
  const mapped = [...tsx.matchAll(/^  "([a-z0-9-]+)": \w+Icon,$/gm)].map((m) => m[1])
  assert.deepEqual(mapped, goNames)
  for (const need of ["file-text", "shield-check", "scissors", "clipboard-list", "search-check"]) assert.ok(ICON_NAMES.includes(need as never), need)
  // No renderer keeps its own short icon list any more.
  assert.doesNotMatch(readFileSync(join(webRoot, "components", "presentations", "page-preview.tsx"), "utf8"), /const ICONS/)
})

test("workflow edges default to reading order and drop unknown ids", () => {
  assert.deepEqual(workflowEdges(wf()), [{ from: 0, to: 1 }, { from: 1, to: 2 }])
  const b = { ...wf(), edges: [{ from: "a", to: "c", label: "skip" }, { from: "a", to: "zzz" }, { from: "b", to: "b" }] }
  assert.deepEqual(workflowEdges(b), [{ from: 0, to: 2, label: "skip" }])
  assert.deepEqual(rowsFor(12, 5), [4, 4, 4])
  assert.deepEqual(rowsFor(3, 5), [3])
  // Neighbours join side to side, in whichever direction they sit.
  const right = connector({ x: 0, y: 0, w: 100, h: 50 }, { x: 150, y: 0, w: 100, h: 50 })
  assert.match(right.d, /^M 100 25 /)
  const left = connector({ x: 150, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 50 })
  assert.match(left.d, /^M 150 25 /)
  assert.match(left.d, / 100 25$/)
})

test("workflow print SVG flows right-to-left in Arabic", () => {
  const xs = (svg: string) =>
    [...svg.matchAll(/<g data-step="([a-z])"><rect x="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])] as const)
  const en = xs(workflowSVG(wf(), "en", stubIcon))
  const ar = xs(workflowSVG(wf(), "ar", stubIcon))
  assert.deepEqual(en.map((x) => x[0]), ["a", "b", "c"])
  assert.ok(en[0][1] < en[1][1] && en[1][1] < en[2][1], "LTR runs left to right")
  assert.ok(ar[0][1] > ar[1][1] && ar[1][1] > ar[2][1], "RTL runs right to left")
  const svg = workflowSVG(wf(), "ar", stubIcon)
  assert.ok(svg.includes("Ship &lt;now&gt;") && !svg.includes("<now>"))
  assert.ok(svg.includes('data-icon="shopping-cart"'), "icons are drawn")
  assert.ok(svg.includes("#e2661c"), "the highlighted step is marked")
  assert.equal(svg.match(/marker-end=/g)?.length, 2)
})

const screen = (): ScreenBlock => ({
  type: "screen",
  frame: "browser",
  url: "app.acme.test",
  layout: "sidebar",
  nav: [{ label: "Orders", icon: "package", active: true }],
  parts: [
    { type: "kpis", items: [{ label: "Open", value: "12" }] },
    { type: "table", columns: ["A"], rows: [{ cells: ["<b>x</b>"], status: "Paid", tone: "success" }] },
    { type: "split", left: [{ type: "callout", tone: "danger", text: "Before" }], right: [{ type: "image", url: "javascript:alert(1)", alt: "x" }] },
  ],
  annotations: [{ target_part_index: 1, text: "Live" }],
})

test("screen print HTML: every part, escaped, numbered notes, no unsafe images", () => {
  const html = screenHTML(screen(), "ar", stubIcon, "https://site.test")
  assert.match(html, /dir="rtl"/)
  assert.ok(html.includes("app.acme.test") && html.includes("class=\"side-nav\""))
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;") && !html.includes("<b>x</b>"))
  assert.equal(html.match(/<span class="marks"><b>1<\/b>/g)?.length, 1)
  assert.ok(html.includes("<li><b>1</b>Live</li>"))
  assert.ok(!html.includes("javascript:"))
  assert.ok(html.includes("Before"))
})

test("decks print icons, rich bullets, workflow, screen and the embed's first screen with its link", () => {
  const page = fixture<PageContent>("page")
  const deck: DeckContent = {
    title: "D",
    slides: [
      { type: "title", title: "T", icon: "factory" },
      { type: "bullets", title: "B", bullets: ["plain", { text: "rich", icon: "zap" }] },
      { type: "metric", metrics: [{ label: "L", value: "1", icon: "gauge" }] },
      { ...wf() },
      { ...screen(), title: "S" },
      { type: "embed", title: "E", document_id: "p1" },
    ],
  }
  const html = deckPrintHTML(deck, doc("en"), markdownToHtml, { p1: { content: page } }, {
    icon: stubIcon,
    embedLink: (id) => `https://site.test/en/p/TOKEN/embed/${id}`,
  })
  for (const i of ["factory", "zap", "gauge", "shopping-cart", "package"]) assert.ok(html.includes(`data-icon="${i}"`), i)
  assert.ok(html.includes("<span>plain</span>") && html.includes("<span>rich</span>"))
  assert.ok(html.includes("slide-workflow") && html.includes("<svg xmlns"))
  assert.ok(html.includes("slide-screen") && html.includes("class=\"frame browser\""))
  assert.ok(html.includes('class="shot"') && html.includes("Every parcel, live."), "the page's hero is drawn")
  assert.ok(html.includes("Open the page: <a href=\"https://site.test/en/p/TOKEN/embed/p1\""))
  const ar = deckPrintHTML(deck, doc("ar"), markdownToHtml, { p1: { content: page } }, { embedLink: () => "https://x" })
  assert.ok(ar.includes("افتح الصفحة"))
  // Without a link (no share) nothing dangles.
  assert.ok(!embedShotHTML(page, stubIcon, { linkLabel: "Open" }).includes("shot-link"))
})

test("reports print workflow and screen blocks; Word gets clean tables", async () => {
  const report = fixture<ReportContent>("report")
  report.sections[0].blocks.push(wf(), screen())
  const html = reportPrintHTML(report, doc("en"), markdownToHtml, { preparedFor: "P", summary: "S" }, { icon: stubIcon })
  assert.ok(html.includes('class="wf-block"') && html.includes('class="screen-block"'))
  const docx = await reportDocx(report, { locale: "en", customer: "S", company: "A" }, { preparedFor: "P", summary: "S", data: "D", step: "Step", next: "Leads to" })
  const xml = zipEntry(docx, "word/document.xml")
  assert.ok(xml.includes("1. Order") && xml.includes("→ Check") && xml.includes(">Leads to<"))
  assert.ok(xml.includes("Paid") && xml.includes("Live"))
})

test("templates offer workflow and screen in every kind", () => {
  for (const k of ["deck", "report", "page"] as const) {
    assert.ok(ITEM_TEMPLATES[k].workflow && ITEM_TEMPLATES[k].screen, k)
  }
})

test("RTL report bars draw the first series on the right, like the legend", () => {
  assert.deepEqual(seriesDrawOrder(["s0", "s1", "s2"], true, "bar"), ["s2", "s1", "s0"])
  assert.deepEqual(seriesDrawOrder(["s0", "s1"], false, "bar"), ["s0", "s1"])
  // Stacks are vertical and lines overlap: their order is unchanged.
  assert.deepEqual(seriesDrawOrder(["s0", "s1"], true, "stacked_bar"), ["s0", "s1"])
  assert.deepEqual(seriesDrawOrder(["s0", "s1"], true, "line"), ["s0", "s1"])
  const tsx = readFileSync(join(webRoot, "components", "presentations", "report-chart.tsx"), "utf8")
  assert.ok(tsx.includes("drawKeys = seriesDrawOrder(keys, rtl, block.chart)"))
  assert.match(tsx, /\{drawKeys\.map\(\(k\) => \(\s*<Bar/)
  assert.ok(tsx.includes("payload={bySlot(payload)}"), "the legend is ordered by series slot")
  assert.ok(tsx.includes("<div dir={dir} data-legend-dir"), "the legend follows the reading direction")
})

test("hero visual: template, renderer shapes, readable print sizes", () => {
  const hero = ITEM_TEMPLATES.page.hero as { visual?: { type: string } }
  assert.equal(hero.visual?.type, "screen")
  const tsx = readFileSync(join(webRoot, "components", "presentations", "page-preview.tsx"), "utf8")
  assert.ok(tsx.includes('"mx-auto max-w-4xl text-center"'), "a hero without scene or visual uses the full width")
  assert.ok(tsx.includes("data-hero-visual"), "the hero renders its visual")
  assert.ok(tsx.includes('!compact && !s.visual && "lg:start-1/2"'), "only a scene-only hero reserves the scene half")
  // Print: nothing in a screen mockup below 8pt.
  const css = readFileSync(join(here, "export-blocks.ts"), "utf8").split("export const BLOCK_CSS")[1]
  for (const m of css.matchAll(/font-size: ([\d.]+)pt/g)) assert.ok(Number(m[1]) >= 8, `print text at ${m[1]}pt`)
  const slide = readFileSync(join(webRoot, "components", "presentations", "slide.tsx"), "utf8")
  assert.ok(slide.includes('minScale={0.8}') && slide.includes("pres-screen-slide"), "screen slides do not shrink below 80%")
})

test("frame app is a phone: tab bar, stacked cards, notes beside, print phone", () => {
  const app: ScreenBlock = {
    ...screen(),
    frame: "app",
    screen_title: "Bookings",
    nav: [{ label: "Home", icon: "layout-dashboard", active: true }, { label: "Chat", icon: "message-circle" }],
  }
  const html = screenHTML(app, "en", stubIcon, "https://site.test")
  assert.ok(html.includes('class="screen-block phone-block"') && html.includes('class="phone"'))
  assert.ok(html.includes('<nav class="ptabs"><span class="on">'), "nav is a bottom tab bar with the active tab marked")
  assert.ok(html.includes('<div class="phead">Bookings</div>'), "screen_title is the app header")
  assert.ok(html.includes('class="prow"') && !html.includes('class="st"'), "tables become cards")
  assert.ok(html.includes("<li><b>1</b>Live</li>"))
  assert.ok(!screenHTML({ ...app, frame: "browser" }, "en", stubIcon, "").includes("phone"))
  const tsx = readFileSync(join(webRoot, "components", "presentations", "screen-view.tsx"), "utf8")
  assert.ok(tsx.includes('if (block.frame === "app") return <PhoneScreen'), "every app screen renders as a phone")
  assert.ok(tsx.includes("data-tab-bar") && tsx.includes("data-status-bar") && tsx.includes('aspectRatio: "390 / 780"'))
  const slide = readFileSync(join(webRoot, "components", "presentations", "slide.tsx"), "utf8")
  assert.ok(slide.includes('if (slide.frame === "app")') && slide.includes("pres-app-slide"), "app slides are side by side")
})

// ---- dispatch map -------------------------------------------------------------

import { cityFor, markerColor, PRINT_PALETTE, routePoints } from "./map.ts"
import { mapSVG } from "./export-blocks.ts"
import type { MapPart } from "./types.ts"

const dispatch = (): MapPart => ({
  type: "map",
  title: "Live <dispatch>",
  legend: true,
  markers: [
    { id: "v1", x: 30, y: 40, kind: "vendor", label: "Pizza Roma" },
    { id: "d1", x: 42, y: 55, kind: "driver", label: "علي", status: "available" },
    { id: "d2", x: 70, y: 70, kind: "driver", status: "busy" },
    { id: "c1", x: 75, y: 30, kind: "customer", label: "#88" },
  ],
  routes: [
    { from: "d2", to: "c1", via: [{ x: 72, y: 50 }], tone: "info", label: "6 min" },
    { from: "d2", to: "missing" },
  ],
  suggest: { vendor: "v1", driver: "d1", eta: "4 min", distance: "1.2 km" },
  zones: [{ x: 35, y: 45, r: 20, label: "Downtown", tone: "success" }],
})

test("map: the city is deterministic and sized by height", () => {
  const a = cityFor(dispatch())
  assert.deepEqual(a, cityFor(dispatch()), "same markers, same city")
  assert.equal(a.w, 1000)
  assert.equal(a.h, 600)
  assert.equal(cityFor({ ...dispatch(), height: "lg" }).h, 780)
  assert.ok(a.streets.length > 8 && a.streets.some((s) => s.main))
  assert.notDeepEqual(a.streets, cityFor({ ...dispatch(), markers: [{ id: "x", x: 1, y: 1, kind: "hub" }] }).streets)
  assert.deepEqual(routePoints(dispatch(), a, dispatch().routes![0]), [
    { x: 700, y: 420 },
    { x: 720, y: 300 },
    { x: 750, y: 180 },
  ])
  assert.equal(routePoints(dispatch(), a, dispatch().routes![1]), null, "a route to a missing marker is dropped")
  assert.equal(markerColor({ id: "", x: 0, y: 0, kind: "driver", status: "busy" }, PRINT_PALETTE), PRINT_PALETTE.warning)
  assert.equal(markerColor({ id: "", x: 0, y: 0, kind: "driver", status: "offline" }, PRINT_PALETTE), PRINT_PALETTE.neutral)
  assert.equal(markerColor({ id: "", x: 0, y: 0, kind: "driver" }, PRINT_PALETTE), PRINT_PALETTE.success)
})

test("map print: markers, one route, the suggestion, escaped, never mirrored", () => {
  const svg = mapSVG(dispatch(), "ar", stubIcon)
  assert.equal(svg.match(/data-marker=/g)?.length, 4)
  assert.equal(svg.match(/<path data-route/g)?.length, 1)
  assert.ok(svg.includes("data-suggest") && svg.includes("4 min · 1.2 km"))
  assert.ok(svg.includes('data-icon="bike"') && svg.includes('data-icon="store"') && svg.includes('data-icon="map-pin"'))
  assert.ok(svg.includes("Downtown") && svg.includes("علي"))
  assert.ok(svg.includes('direction="ltr"'), "the map itself stays left-to-right")
  assert.ok(!svg.includes("<dispatch>"))
  // In a screen, in both frames, with a legend.
  const scr: ScreenBlock = { type: "screen", frame: "tablet", parts: [dispatch()] }
  const html = screenHTML(scr, "en", stubIcon, "")
  assert.ok(html.includes('class="card mapc"') && html.includes('class="legend"') && html.includes('class="tbar"'))
  assert.ok(screenHTML({ ...scr, frame: "app" }, "en", stubIcon, "").includes('class="phone"'))
  const desk = screenHTML({ ...scr, frame: "desktop", screen_title: "Dispatch" }, "en", stubIcon, "")
  assert.ok(desk.includes('<span class="appname">Dispatch</span>') && !desk.includes('class="url"'), "desktop: title bar, no address bar")
  // The live view keeps the map LTR and animates only with motion allowed.
  const tsx = readFileSync(join(webRoot, "components", "presentations", "map-view.tsx"), "utf8")
  assert.ok(tsx.includes('dir="ltr"') && tsx.includes("data-map"))
  assert.ok(tsx.includes("prefersReducedMotion()") && tsx.includes("loop: true"))
  const css = readFileSync(join(webRoot, "components", "presentations", "presentations.css"), "utf8")
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.pres-pulse/)
})

test("map in Word: a table of its markers", async () => {
  const report = fixture<ReportContent>("report")
  report.sections[0].blocks = [{ type: "screen", frame: "tablet", parts: [dispatch()] }]
  const xml = zipEntry(await reportDocx(report, { locale: "en", customer: "S", company: "A" }, { preparedFor: "P", summary: "S", data: "D", marker: "Marker" }), "word/document.xml")
  assert.ok(xml.includes(">Marker<") && xml.includes(">Pizza Roma<") && xml.includes(">busy<") && xml.includes(">vendor<"))
})
