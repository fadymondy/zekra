"use client"

import { useParams } from "next/navigation"

import { PresentationEditor } from "@/components/presentations/admin/presentation-editor"
import "@/components/presentations/presentations.css"

/** One document's editor and live preview, inside its brain. */
export default function PresentationPage() {
  const { locale, namespace, id } = useParams<{ locale: string; namespace: string; id: string }>()
  return <PresentationEditor id={decodeURIComponent(id)} locale={locale} namespace={decodeURIComponent(namespace)} />
}
