import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import type { ThemePalette } from "@shared/markdown/themes/themes";

/*
Syntax highlighting for the mobile code block (MH-319 item 1).

highlight.js itself is pure JS and runs fine under Hermes; what is DOM-bound is
its OUTPUT — `highlight()` returns an HTML string. So this takes that string
and turns it back into flat {text, scope} runs that React Native can render as
<Text> children. Parsing hljs's own output rather than using its emitter API is
deliberate: the emitter is internal and has changed shape across major
versions, while the markup it emits (nested spans, five HTML entities) has not.

Only the core is imported, with the languages notes actually contain. The full
bundle registers ~190 grammars, most of a megabyte, to highlight the
occasional snippet.

Colours come from the reading theme rather than from an hljs stylesheet, so all
27 themes get highlighting for free and none of them can drift out of step with
the surrounding text. That is the sync problem that made this worth a decision;
deriving from the palette is what avoids it.
*/

const LANGUAGES: Record<string, LanguageFn> = {
  bash, css, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml,
};

// hljs's own type, imported indirectly to avoid a named import that differs
// between versions.
type LanguageFn = Parameters<typeof hljs.registerLanguage>[1];

/** Aliases notes actually use in fences. */
const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  py: "python", rs: "rust", golang: "go", yml: "yaml",
  html: "xml", svg: "xml", md: "markdown", postgres: "sql", psql: "sql",
};

let registered = false;
function ensureRegistered() {
  if (registered) return;
  for (const [name, fn] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, fn);
  registered = true;
}

/** Resolve a fence language to a registered grammar, or "" for none. */
export function resolveLanguage(lang: string): string {
  const key = (lang || "").toLowerCase();
  const canonical = ALIASES[key] ?? key;
  return canonical in LANGUAGES ? canonical : "";
}

export interface Token {
  text: string;
  /** hljs scope without the "hljs-" prefix, e.g. "keyword"; "" for plain text. */
  scope: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'",
};

function decode(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Flatten hljs's HTML into runs.
 *
 * Scopes nest (a string inside a template inside a function). Rather than
 * model that, the innermost open scope wins — it is the most specific, and it
 * is the one whose colour a reader expects to see.
 */
export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const stack: string[] = [];
  const pattern = /<span class="([^"]*)">|<\/span>/g;
  let last = 0;
  let match: RegExpExecArray | null;

  const push = (raw: string) => {
    if (!raw) return;
    const text = decode(raw);
    const scope = stack.length ? stack[stack.length - 1] : "";
    // Merge with the previous run when the scope is unchanged, so a decoded
    // entity does not split a word into three <Text> nodes.
    const prev = out[out.length - 1];
    if (prev && prev.scope === scope) prev.text += text;
    else out.push({ text, scope });
  };

  while ((match = pattern.exec(html))) {
    push(html.slice(last, match.index));
    if (match[1] !== undefined) {
      // "hljs-keyword" -> "keyword"; sub-language spans ("language-xml") carry
      // no colour of their own, so they inherit by pushing the current scope.
      const cls = match[1].split(/\s+/).find((c) => c.startsWith("hljs-"));
      stack.push(cls ? cls.slice(5) : (stack[stack.length - 1] ?? ""));
    } else {
      stack.pop();
    }
    last = pattern.lastIndex;
  }
  push(html.slice(last));
  return out;
}

/** Highlight, or a single plain run when the language is unknown. */
export function highlight(code: string, lang: string): Token[] {
  const language = resolveLanguage(lang);
  if (!language) return [{ text: code, scope: "" }];
  ensureRegistered();
  try {
    return tokenize(hljs.highlight(code, { language, ignoreIllegals: true }).value);
  } catch {
    // A grammar can still throw on pathological input; unhighlighted code is
    // far better than a blank note.
    return [{ text: code, scope: "" }];
  }
}

/*
Map an hljs scope onto the reading theme.

Four buckets, not forty: the palette has four usable colours, and inventing
more would mean picking hex values that no theme chose and that would clash
with two thirds of them. Comments recede, literals and keywords are the two
things you scan for, everything else is body text.
*/
export function tokenColor(scope: string, palette: ThemePalette, fallback: string): string {
  if (!scope) return fallback;
  const base = scope.split(".")[0];
  switch (base) {
    case "comment":
    case "quote":
      return palette.fgMuted;
    case "string":
    case "regexp":
    case "number":
    case "literal":
    case "symbol":
    case "addition":
      return palette.link;
    case "keyword":
    case "built_in":
    case "type":
    case "selector-tag":
    case "doctag":
    case "meta":
      return palette.accent;
    case "title":
    case "name":
    case "attr":
    case "attribute":
    case "variable":
    case "property":
    case "tag":
      return palette.linkHover;
    default:
      return fallback;
  }
}
