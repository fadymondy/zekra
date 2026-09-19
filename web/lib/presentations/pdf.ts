/*
Print HTML → PDF through headless Chromium (puppeteer-core). Ported from fadymondy.com-v2's
lib/cv-pdf.ts, which chose Chromium by measurement: it is the only engine tried whose
Arabic text layer extracts correctly. Server only.

WHERE CHROMIUM COMES FROM
  - CHROME_PATH, when set, always wins (any OS).
  - Linux without CHROME_PATH: @sparticuz/chromium, a self-contained Chromium shipped in
    node_modules (bin/*.tar.br, unpacked to the OS temp dir on first use). Its system
    libraries (al2023.tar.br) are unpacked and put on LD_LIBRARY_PATH here too, because the
    package only does that itself on Lambda/Vercel/Netlify.
  - Windows/macOS workstations: an installed Google Chrome, or /usr/bin/chromium.

THE FONT. Readex Pro (OFL, Latin + Arabic, one variable file) is embedded from
assets/fonts/pdf, so the output never depends on server fonts. Ligatures are turned off in
the print CSS (export-html.ts) so lam-alef extracts correctly from the PDF text layer.
*/
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { PDFDocument } from "pdf-lib"
import type { Browser } from "puppeteer-core"

const FONT_FILE = path.join(process.cwd(), "assets", "fonts", "pdf", "ReadexPro[HEXP,wght].ttf")

let fontCSS: string | null = null

/** The embedded Readex Pro @font-face (family "Print Readex"), read once per process. */
export function pdfFontCSS(): string {
  if (fontCSS !== null) return fontCSS
  try {
    const data = readFileSync(FONT_FILE).toString("base64")
    fontCSS = `@font-face { font-family: "Print Readex"; font-weight: 160 700; font-style: normal; src: url(data:font/ttf;base64,${data}) format("truetype"); }`
  } catch {
    // A missing font file degrades to the system sans-serif rather than failing the export.
    console.warn(`[presentations] PDF font not found at ${FONT_FILE}; using system fonts`)
    fontCSS = ""
  }
  return fontCSS
}

/** Where Chrome lives on a workstation; Linux servers use @sparticuz/chromium. */
function localChrome(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
  return candidates.find((p): p is string => Boolean(p) && existsSync(p as string))
}

let browserPromise: Promise<Browser> | null = null

/*
One browser per process, started on first use and reused: launching Chromium costs far more
than rendering a page. A crashed or closed browser clears the slot so the next request starts
a fresh one instead of failing forever.
*/
// A runtime import the bundler cannot analyse: Turbopack statically pruned the Linux branch
// (compiled it to "unreachable"), so Chromium was never loaded on the server.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runtimeImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>

function isLinuxRuntime(): boolean {
  return existsSync("/proc/self/exe") && !existsSync("C:\Windows")
}

function browser(): Promise<Browser> {
  browserPromise ??= (async () => {
    // Bundled dynamic imports of external packages may add one level of default-wrapping.
    const pmod = (await runtimeImport("puppeteer-core")) as unknown as { default?: unknown; launch?: unknown }
    const puppeteer = ((pmod as { launch?: unknown }).launch ? pmod : (pmod.default as { launch?: unknown })?.launch ? pmod.default : (pmod.default as { default?: unknown })?.default) as typeof import("puppeteer-core").default
    const override = process.env.CHROME_PATH
    const launched =
      // Decided by the filesystem at run time: the bundler folds process.platform and even
      // os.platform() into build-time constants, so a Windows-built bundle pruned this branch.
      isLinuxRuntime() && !override
        ? await (async () => {
            const pkg = (await runtimeImport("@sparticuz/chromium")) as typeof import("@sparticuz/chromium")
            const cmod = pkg as unknown as { default?: { executablePath?: unknown; default?: unknown } }
            const chromium = (cmod.default?.executablePath ? cmod.default : cmod.default?.default) as typeof pkg.default
            const bin = path.join(process.cwd(), "node_modules", "@sparticuz", "chromium", "bin")
            const libs = path.join(bin, "al2023.tar.br")
            if (existsSync(libs)) {
              await pkg.inflate(libs)
              pkg.setupLambdaEnvironment(path.join(tmpdir(), "al2023", "lib"))
            }
            return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(bin), headless: true })
          })()
        : await (async () => {
            const executablePath = localChrome()
            if (!executablePath) throw new Error("No Chrome found for PDF rendering. Set CHROME_PATH.")
            return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] })
          })()
    launched.on("disconnected", () => {
      browserPromise = null
    })
    return launched
  })().catch((err) => {
    browserPromise = null
    throw err
  })
  return browserPromise
}

/**
 * Any print HTML through the shared browser. The page size comes from the document's @page
 * rule. Metadata: title, subject, language.
 */
export async function htmlToPdf(html: string, meta: { title: string; lang: "en" | "ar"; subject?: string }): Promise<Buffer> {
  const page = await (await browser()).newPage()
  let raw: Uint8Array
  try {
    // Print HTML is self-contained; nothing it references needs the network except images the
    // author linked, which load like any page.
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    raw = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true, outline: true })
  } finally {
    await page.close().catch(() => undefined)
  }
  const doc = await PDFDocument.load(raw, { updateMetadata: false })
  doc.setTitle(meta.title, { showInWindowTitleBar: true })
  if (meta.subject) doc.setSubject(meta.subject)
  doc.setCreator("Zekra")
  doc.setProducer("Zekra presentations (Chromium)")
  doc.setLanguage(meta.lang)
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}
