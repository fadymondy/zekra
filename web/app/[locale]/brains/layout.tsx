"use client"

import { AppShell } from "@/components/shell/app-shell"

export default function BrainsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
