"use client"

import { useParams, useSelectedLayoutSegment } from "next/navigation"
import { AppShell } from "@/components/shell/app-shell"
import { ForbiddenState } from "@/components/states-extra"
import { ACCOUNT_NAV, ADMIN_NAV, brainNav } from "@/lib/nav"
import { isAdmin, useMe } from "@/lib/queries"

// One shell for every signed-in area (brains, a brain's workspace, account, admin). It lives in this
// shared layout so moving between areas, or switching brains, keeps the sidebar, header and realtime
// connection mounted and only swaps the page, instead of tearing the whole app down.
export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  const section = useSelectedLayoutSegment()
  const { namespace } = useParams<{ namespace?: string }>()
  const me = useMe()

  if (section === "b" && namespace) {
    const ns = decodeURIComponent(namespace)
    return (
      <AppShell groups={brainNav(ns)} brain={ns}>
        {children}
      </AppShell>
    )
  }
  if (section === "admin") {
    // The API enforces the admin/owner role on every /api/admin/* call; the gate here only keeps a
    // member from seeing an empty panel.
    const gate = me.data && !isAdmin(me.data) ? <ForbiddenState /> : undefined
    return (
      <AppShell groups={ADMIN_NAV} gate={gate}>
        {children}
      </AppShell>
    )
  }
  return <AppShell groups={section === "account" ? ACCOUNT_NAV : undefined}>{children}</AppShell>
}
