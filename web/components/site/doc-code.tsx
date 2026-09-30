"use client"

import { CodeBlock } from "@fadymondy/nasaq/web"

import { bundledLanguages } from "shiki"


/*
Fenced code in a doc, highlighted by the registry CodeBlock (shiki, in the browser). A fence
language shiki does not ship ("env", "conf") is drawn as plain text: passing it through made
codeToHtml reject and the block sat on its spinner. Ported from fadymondy.com-v2
components/docs/doc-code.tsx.
*/
export function DocCode({ code, language }: { code: string; language?: string }) {
  const lang = language && language in bundledLanguages ? language : "text"
  return <CodeBlock code={code} language={lang} filename={language || undefined} className="not-prose my-2 rounded-none" />
}
