"use client"

import { AppShell } from "@/components/shell/app-shell"

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
