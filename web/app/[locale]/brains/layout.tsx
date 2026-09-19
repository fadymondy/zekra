"use client"

import { AppShell } from "@/components/shell/app-shell"
import { BRAINS_NAV } from "@/lib/nav"

export default function BrainsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell groups={BRAINS_NAV}>{children}</AppShell>
}
