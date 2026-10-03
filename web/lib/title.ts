"use client"

import { useEffect } from "react"

/** Every route sets its own document title: "<page> · Zekra" (ذكرى's Latin name in both languages). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const name = document.documentElement.lang === "ar" ? "ذكرى" : "Zekra"
    document.title = title ? `${title} · ${name}` : name
  }, [title])
}
