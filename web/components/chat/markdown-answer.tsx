"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { useTranslations } from "@/lib/i18n"

/** Inline [n] citations become links to #cite-n so the markdown renderer keeps them inline. */
function linkCitations(text: string) {
  // Skip real markdown links ("[1](...)") and reference definitions.
  return text.replace(/\[(\d+)\](?![(:])/g, "[$1](#cite-$1)")
}

/** An assistant answer as markdown. [n] citations render as mono footnote chips. */
export function MarkdownAnswer({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const { t } = useTranslations()
  return (
    <div dir="auto" className="space-y-3 text-sm leading-relaxed text-grid-fg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/)
            if (m) {
              const n = Number(m[1])
              return (
                <button
                  type="button"
                  onClick={() => onCite(n)}
                  title={t("chat.sourceN", { n })}
                  className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center border border-line bg-grid-soft px-1 align-baseline font-mono text-[11px] font-medium text-grid-action hover:border-grid-action"
                >
                  {n}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-grid-action">
                {children}
              </a>
            )
          },
          h1: ({ children }) => <h3 className="text-base font-medium">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-medium">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-medium">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc space-y-1 ps-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 ps-5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-s-2 border-line ps-3 text-grid-body">{children}</blockquote>,
          code: ({ children, className }) =>
            className ? (
              <code dir="ltr" className="block overflow-x-auto border border-line bg-grid-soft p-3 font-mono text-xs">
                {children}
              </code>
            ) : (
              <code className="bg-grid-soft px-1 font-mono text-[0.85em]">{children}</code>
            ),
          pre: ({ children }) => <pre className="whitespace-pre">{children}</pre>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-line text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-line px-2 py-1 text-start font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  )
}
