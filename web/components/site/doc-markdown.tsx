import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { headingId, isMissingDocLink, resolveHref, type DocPage, type DocsBundle } from "@/lib/site/docs"
import { DocCode } from "@/components/site/doc-code"

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children)
  }
  return ""
}

/**
 * A doc, rendered. Links are rewritten to the docs routes (see resolveHref), h2/h3 get the
 * anchors the TOC links to, and fenced code goes to DocCode. Ported from fadymondy.com-v2
 * components/docs/doc-markdown.tsx.
 */
export function DocMarkdown({
  page,
  bundle,
  locale,
  content,
}: {
  page: DocPage
  bundle: DocsBundle
  locale: string
  content: string
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (isMissingDocLink(href ?? "", page, bundle)) return <span>{children}</span>
          const to = resolveHref(href ?? "", page, locale)
          const external = /^https?:\/\//.test(to)
          return (
            <a href={to} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {children}
            </a>
          )
        },
        img: ({ src, alt }) =>
          typeof src === "string" ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary-size repo images
            <img src={resolveHref(src, page, locale)} alt={alt ?? ""} loading="lazy" />
          ) : null,
        h2: ({ children }) => <h2 id={headingId(textOf(children))}>{children}</h2>,
        h3: ({ children }) => <h3 id={headingId(textOf(children))}>{children}</h3>,
        // The block itself is drawn by DocCode, which brings its own frame.
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const text = textOf(children).replace(/\n$/, "")
          const language = /language-([\w+-]+)/.exec(className ?? "")?.[1]
          if (!language && !text.includes("\n")) return <code>{children}</code>
          return <DocCode code={text} language={language} />
        },
      }}
    >
      {content.replace(/<!--[\s\S]*?-->/g, "")}
    </ReactMarkdown>
  )
}
