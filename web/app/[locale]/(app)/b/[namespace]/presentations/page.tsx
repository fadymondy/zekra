"use client"

import { useParams } from "next/navigation"

import { PresentationsList } from "@/components/presentations/admin/presentations-list"
import "@/components/presentations/presentations.css"

/** A brain's decks, reports and page previews. */
export default function PresentationsPage() {
  const { locale, namespace } = useParams<{ locale: string; namespace: string }>()
  return <PresentationsList locale={locale} namespace={decodeURIComponent(namespace)} />
}
