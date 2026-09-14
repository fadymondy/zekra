import { Outlet, useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { Users, KeyRound, Search, ChevronRight } from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarInset, SidebarTrigger, ThemePicker,
} from "@togo-framework/ui";
import { LiveIndicator } from "../lib/realtime";
import { SidebarBrand } from "../components/brand";
import { UserMenu } from "../components/chrome";
import { useSidebarState } from "../lib/sidebar";

// Cross-brain admin, kept out of the main brain flow. Users + Tokens/ACL are the
// global controls; a global cross-brain search lives here too.
const ADMIN_NAV = [
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/tokens", label: "Tokens & ACL", icon: KeyRound },
  { to: "/admin/search", label: "Global search", icon: Search },
];

const LABELS: Record<string, string> = {
  "/admin/users": "Users",
  "/admin/tokens": "Tokens & ACL",
  "/admin/search": "Global search",
};

export function AdminLayout() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) => pathname.startsWith(to);
  const crumb = LABELS[pathname] ?? "Admin";
  const sidebar = useSidebarState();

  return (
    <SidebarProvider open={sidebar.open} onOpenChange={sidebar.setOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarBrand title="Back to Brains" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              {ADMIN_NAV.map((n) => (
                <SidebarMenuItem key={n.to}>
                  <SidebarMenuButton isActive={isActive(n.to)} tooltip={n.label} onClick={() => nav({ to: n.to })}>
                    <n.icon className="h-4 w-4" />
                    <span>{n.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <nav className="flex items-center gap-1.5 text-sm">
              <Link to="/" className="text-muted-foreground hover:text-foreground">Brains</Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />
              <span className="font-medium text-foreground">{crumb}</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator />
            <ThemePicker size="default" />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto"><Outlet /></main>
      </SidebarInset>
    </SidebarProvider>
  );
}
