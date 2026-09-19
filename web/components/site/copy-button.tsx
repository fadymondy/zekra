"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

function useCopied(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false)
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    })
  }
  return [done, copy]
}

/** Copies `text`; the icon flips to a check for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, copy] = useCopied()
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => copy(text)}
      className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
    >
      {done ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  )
}

/** The docs toolbar's "Copy page": the page's markdown, for pasting into an assistant. */
export function CopyPageButton({ markdown, label, copied }: { markdown: string; label: string; copied: string }) {
  const [done, copy] = useCopied()
  return (
    <button
      type="button"
      onClick={() => copy(markdown)}
      className="inline-flex h-8 items-center gap-1.5 border border-line px-2.5 text-xs transition-colors hover:bg-muted/40"
    >
      {done ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {done ? copied : label}
    </button>
  )
}
