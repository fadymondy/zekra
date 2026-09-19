"use client"

import { useEffect } from "react"

/** Every route sets its own document title: "<page> · Zekra" (ذكرة's Latin name in both languages). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Zekra` : "Zekra"
  }, [title])
}
