"use client"

import { useParams } from "next/navigation"

import { PresentationsList } from "@/components/presentations/admin/presentations-list"
import "@/components/presentations/presentations.css"

/** Every brain's presentations, for admins. Rows open in their own brain. */
export default function AdminPresentationsPage() {
  const { locale } = useParams<{ locale: string }>()
  return <PresentationsList locale={locale} />
}
