/*
Markdown to HTML for the print exports (FM-344).

The same parser react-markdown uses on the page (remark + GFM), with raw HTML
dropped (remark-rehype's default) and every href/src that is not http(s),
mailto or a site path removed — so a report's markdown can never put a script
or a javascript: link into the PDF.
*/
import { toHtml } from "hast-util-to-html"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"

type HNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[] }

const SAFE = /^(https?:|mailto:|\/(?!\/)|#)/i

function clean(node: HNode) {
  if (node.properties) {
    for (const key of ["href", "src"]) {
      const v = node.properties[key]
      if (typeof v === "string" && !SAFE.test(v.trim())) delete node.properties[key]
    }
    for (const key of Object.keys(node.properties)) {
      if (/^on/i.test(key)) delete node.properties[key]
    }
  }
  node.children?.forEach(clean)
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)

export function markdownToHtml(markdown: string): string {
  const tree = processor.runSync(processor.parse(markdown)) as unknown as HNode
  clean(tree)
  return toHtml(tree as never)
}
