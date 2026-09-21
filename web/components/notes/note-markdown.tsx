"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/** A note body as markdown, styled with the grid tokens (no typography plugin). */
export function NoteMarkdown({ text }: { text: string }) {
  return (
    <div
      dir="auto"
      className="space-y-3 text-sm leading-relaxed text-grid-fg [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-3 [&_blockquote]:text-grid-muted [&_code]:bg-grid-soft [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-xl [&_h1]:font-medium [&_h2]:text-lg [&_h2]:font-medium [&_h3]:font-medium [&_hr]:border-line [&_li]:ps-1 [&_ol]:list-decimal [&_ol]:list-outside [&_ol]:ps-5 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-line [&_pre]:bg-grid-card [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-start [&_ul]:list-disc [&_ul]:list-outside [&_ul]:ps-5"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
