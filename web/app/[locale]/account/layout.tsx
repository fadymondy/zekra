"use client"

import { AppShell } from "@/components/shell/app-shell"
import { ACCOUNT_NAV } from "@/lib/nav"

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AppShell groups={ACCOUNT_NAV}>{children}</AppShell>
}
