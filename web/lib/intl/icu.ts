// A small ICU MessageFormat subset, shared by every Zekra client (web, desktop, mobile) and
// mirrored in Go by internal/i18n for server-rendered text (emails, push). Pure TS.
//
// Supported:
//   {name}                                    argument
//   {count, plural, =0 {…} one {# item} other {# items}}   CLDR plural (Intl.PluralRules)
//   {count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}
//   {kind, select, note {…} memory {…} other {…}}
//   #  inside a plural branch → the number, locale-formatted
//   Apostrophes are ALWAYS literal — unlike ICU quoting — so copy such as "Delete '{name}'?"
//   and "don't" keeps working. A literal { or } can't be written; no message needs one.
//
// Not supported (on purpose): number/date/time skeletons. Format those with the useTranslations()
// helpers (formatDate, formatNumber, timeAgo) and pass the result in as a plain argument.

export type Vars = Record<string, string | number | null | undefined>

type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string }
  | { t: "pound" }
  | { t: "plural"; name: string; ordinal: boolean; offset: number; options: Record<string, Node[]> }
  | { t: "select"; name: string; options: Record<string, Node[]> }

export class MessageSyntaxError extends Error {}

const PLURAL_KEYS = new Set(["zero", "one", "two", "few", "many", "other"])

function parse(src: string): Node[] {
  let i = 0

  function fail(msg: string): never {
    throw new MessageSyntaxError(`${msg} at ${i} in ${JSON.stringify(src)}`)
  }

  function skipWs() {
    while (i < src.length && /\s/.test(src[i]!)) i++
  }

  function ident(): string {
    skipWs()
    const m = /^[^\s{},#]+/.exec(src.slice(i))
    if (!m) fail("expected a name")
    i += m[0].length
    return m[0]
  }

  // Reads message text until an unquoted `}` (when nested) or the end.
  function message(nested: boolean, inPlural: boolean): Node[] {
    const out: Node[] = []
    let buf = ""
    const flush = () => {
      if (buf) out.push({ t: "text", v: buf })
      buf = ""
    }
    while (i < src.length) {
      const c = src[i]!
      if (c === "{") {
        flush()
        i++
        out.push(argument())
        continue
      }
      if (c === "}") {
        if (!nested) fail("unmatched }")
        flush()
        return out
      }
      if (c === "#" && inPlural) {
        flush()
        out.push({ t: "pound" })
        i++
        continue
      }
      buf += c
      i++
    }
    if (nested) fail("unclosed {")
    flush()
    return out
  }

  function options(inPlural: boolean): Record<string, Node[]> {
    const opts: Record<string, Node[]> = {}
    for (;;) {
      skipWs()
      if (src[i] === "}") {
        i++
        return opts
      }
      if (i >= src.length) fail("unclosed options")
      const key = ident()
      skipWs()
      if (src[i] !== "{") fail(`expected { after ${key}`)
      i++
      if (key in opts) fail(`duplicate option ${key}`)
      opts[key] = message(true, inPlural)
      i++ // the closing }
    }
  }

  function argument(): Node {
    const name = ident()
    skipWs()
    if (src[i] === "}") {
      i++
      return { t: "arg", name }
    }
    if (src[i] !== ",") fail(`expected , or } after ${name}`)
    i++
    const type = ident()
    skipWs()
    if (type === "plural" || type === "selectordinal") {
      if (src[i] !== ",") fail("expected , after plural")
      i++
      skipWs()
      let offset = 0
      const off = /^offset:\s*(\d+)/.exec(src.slice(i))
      if (off) {
        offset = Number(off[1])
        i += off[0].length
      }
      const opts = options(true)
      for (const k of Object.keys(opts)) {
        if (!PLURAL_KEYS.has(k) && !/^=\d+$/.test(k)) fail(`bad plural category ${k}`)
      }
      if (!opts.other) fail(`plural ${name} needs an "other" branch`)
      return { t: "plural", name, ordinal: type === "selectordinal", offset, options: opts }
    }
    if (type === "select") {
      if (src[i] !== ",") fail("expected , after select")
      i++
      const opts = options(false)
      if (!opts.other) fail(`select ${name} needs an "other" branch`)
      return { t: "select", name, options: opts }
    }
    fail(`unsupported argument type ${type}`)
  }

  return message(false, false)
}

const cache = new Map<string, Node[]>()

function compile(src: string): Node[] {
  let ast = cache.get(src)
  if (!ast) {
    ast = parse(src)
    if (cache.size > 5000) cache.clear()
    cache.set(src, ast)
  }
  return ast
}

type PluralSelector = { select(n: number): string }

/** CLDR cardinal rules for the languages Zekra ships, for runtimes without Intl.PluralRules
 *  (Hermes on iOS). Integers only; a fraction falls to "other", which every message has. */
export function cldrCardinal(locale: string, n: number): string {
  const lang = locale.toLowerCase().split(/[-_]/)[0]
  if (!Number.isInteger(n)) return "other"
  const n10 = Math.abs(n) % 10
  const n100 = Math.abs(n) % 100
  switch (lang) {
    case "ar":
      if (n === 0) return "zero"
      if (n === 1) return "one"
      if (n === 2) return "two"
      if (n100 >= 3 && n100 <= 10) return "few"
      if (n100 >= 11) return "many"
      return "other"
    case "ru":
    case "uk":
      if (n10 === 1 && n100 !== 11) return "one"
      if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "few"
      return "many"
    case "pl":
      if (n === 1) return "one"
      if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "few"
      return "many"
    case "fr":
    case "pt":
    case "hi":
      return n === 0 || n === 1 ? "one" : "other"
    case "zh":
    case "ja":
    case "ko":
    case "id":
    case "vi":
      return "other"
    default:
      return n === 1 ? "one" : "other"
  }
}

const pluralRules = new Map<string, PluralSelector>()
function rules(locale: string, ordinal: boolean): PluralSelector {
  const key = `${locale}|${ordinal ? "o" : "c"}`
  let r = pluralRules.get(key)
  if (!r) {
    if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") {
      r = { select: (n) => (ordinal ? "other" : cldrCardinal(locale, n)) }
    } else {
      try {
        r = new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" })
      } catch {
        r = new Intl.PluralRules("en", { type: ordinal ? "ordinal" : "cardinal" })
      }
    }
    pluralRules.set(key, r)
  }
  return r
}

const numberFormats = new Map<string, Intl.NumberFormat>()
function formatNum(n: number, locale: string): string {
  let f = numberFormats.get(locale)
  if (!f) {
    try {
      // Latin digits everywhere (counts and ids read the same in every language), grouping per locale.
      f = new Intl.NumberFormat(`${locale}-u-nu-latn`)
    } catch {
      f = new Intl.NumberFormat("en")
    }
    numberFormats.set(locale, f)
  }
  return f.format(n)
}

function render(nodes: Node[], vars: Vars, locale: string, pound: number | null): string {
  let out = ""
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += n.v
        break
      case "pound":
        out += pound == null ? "#" : formatNum(pound, locale)
        break
      case "arg": {
        const v = vars[n.name]
        out += v == null ? `{${n.name}}` : String(v)
        break
      }
      case "plural": {
        const raw = vars[n.name]
        const num = typeof raw === "number" ? raw : Number(raw)
        if (raw == null || Number.isNaN(num)) {
          out += render(n.options.other!, vars, locale, null)
          break
        }
        const exact = n.options[`=${num}`]
        const branch = exact ?? n.options[rules(locale, n.ordinal).select(num - n.offset)] ?? n.options.other!
        out += render(branch, vars, locale, num - n.offset)
        break
      }
      case "select": {
        const v = vars[n.name]
        out += render(n.options[String(v)] ?? n.options.other!, vars, locale, pound)
        break
      }
    }
  }
  return out
}

/** Fills a catalog message. A message that fails to parse is returned with simple `{name}`
 *  substitution, so one bad translation degrades to readable text instead of crashing a screen. */
export function formatMessage(src: string, vars?: Vars, locale = "en"): string {
  if (!src.includes("{")) return src
  try {
    return render(compile(src), vars ?? {}, locale, null)
  } catch {
    return vars ? src.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k]))) : src
  }
}

/* ------------------------------------------------------------ validation */

function collectArgs(nodes: Node[], into: Set<string>) {
  for (const n of nodes) {
    if (n.t === "arg") into.add(n.name)
    else if (n.t === "plural" || n.t === "select") {
      into.add(n.name)
      for (const branch of Object.values(n.options)) collectArgs(branch, into)
    }
  }
}

/** Argument names a message uses (plain, plural and select). Throws on a syntax error. */
export function messageArgs(src: string): Set<string> {
  const s = new Set<string>()
  collectArgs(parse(src), s)
  return s
}

/** Markup-like tokens that must survive translation: <b>…</b>, <1>, <br/>, and **bold**. */
function tags(src: string): string[] {
  return (src.match(/<\/?[a-zA-Z0-9]+\s*\/?>/g) ?? []).map((t) => t.replace(/\s+/g, "")).sort()
}

/**
 * Problems with `translation` as a rendering of `source`: syntax errors, missing or invented
 * arguments, plural/select without `other`, lost markup tags. [] means it's safe to ship.
 */
export function validateTranslation(source: string, translation: string): string[] {
  const errors: string[] = []
  let want: Set<string>
  try {
    want = messageArgs(source)
  } catch (e) {
    return [`source does not parse: ${(e as Error).message}`]
  }
  let got: Set<string>
  try {
    got = messageArgs(translation)
  } catch (e) {
    return [`does not parse: ${(e as Error).message}`]
  }
  for (const a of want) if (!got.has(a)) errors.push(`missing placeholder {${a}}`)
  for (const a of got) if (!want.has(a)) errors.push(`unknown placeholder {${a}}`)
  const ts = tags(source).join(" ")
  const tt = tags(translation).join(" ")
  if (ts !== tt) errors.push(`markup differs: [${ts}] vs [${tt}]`)
  if (source.trim() !== "" && translation.trim() === "") errors.push("empty translation")
  return errors
}
