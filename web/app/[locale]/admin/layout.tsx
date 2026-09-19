"use client"

import { AppShell } from "@/components/shell/app-shell"
import { ForbiddenState } from "@/components/states-extra"
import { ADMIN_NAV } from "@/lib/nav"
import { isAdmin, useMe } from "@/lib/queries"

// The admin control panel. The API enforces the admin/owner role on every /api/admin/* call;
// the gate here only keeps a member from seeing an empty panel.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const gate = me.data && !isAdmin(me.data) ? <ForbiddenState /> : undefined
  return (
    <AppShell groups={ADMIN_NAV} gate={gate}>
      {children}
    </AppShell>
  )
}
