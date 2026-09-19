import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "cn"

/*
Markdown inside presentations. No raw HTML (react-markdown's default), and
react-markdown's own URL filter drops javascript: and friends.
*/
export function Md({ children, className }: { children?: string; className?: string }) {
  if (!children) return null
  return (
    <div
      className={cn(
        "space-y-3 [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_ol]:list-decimal [&_ol]:ps-6 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:ps-6",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
