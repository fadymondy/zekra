"use client"

import { useParams } from "next/navigation"

import { AppShell } from "@/components/shell/app-shell"
import { brainNav } from "@/lib/nav"

export default function BrainLayout({ children }: { children: React.ReactNode }) {
  const { namespace } = useParams<{ namespace: string }>()
  const ns = decodeURIComponent(namespace)
  return (
    <AppShell groups={brainNav(ns)} brain={ns}>
      {children}
    </AppShell>
  )
}
