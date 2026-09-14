import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Database, Users, KeyRound, Search } from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarInset, SidebarTrigger, StatusBadge, ThemePicker,
} from "@togo-framework/ui";
import { LiveIndicator } from "../lib/realtime";
import { SidebarBrand } from "../components/brand";
import { UserMenu } from "../components/chrome";
import { useSidebarState } from "../lib/sidebar";

// The brain hub is the entry point. Its sidebar is deliberately small: the Brains
// hub itself, plus an Admin group (users, tokens, cross-brain search) kept out of
// the main flow. The old flat Dashboard/Search/Graph/Gaps/Sessions siblings are gone.
const HUB_NAV = [
  { to: "/", label: "Brains", icon: Database, exact: true },
];

const ADMIN_NAV = [
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/tokens", label: "Tokens & ACL", icon: KeyRound },
  { to: "/admin/search", label: "Global search", icon: Search },
];

export function HubLayout() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string, exact?: boolean) => (exact ? pathname === to : pathname.startsWith(to));
  const sidebar = useSidebarState();

  return (
    <SidebarProvider open={sidebar.open} onOpenChange={sidebar.setOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarBrand />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Memory</SidebarGroupLabel>
            <SidebarMenu>
              {HUB_NAV.map((n) => (
                <SidebarMenuItem key={n.to}>
                  <SidebarMenuButton isActive={isActive(n.to, n.exact)} tooltip={n.label} onClick={() => nav({ to: n.to })}>
                    <n.icon className="h-4 w-4" />
                    <span>{n.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
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
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <span className="hidden font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              Memory organ
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator />
            <StatusBadge tone="neutral" className="hidden sm:inline-flex">togo-postgres</StatusBadge>
            <ThemePicker size="default" />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto"><Outlet /></main>
      </SidebarInset>
    </SidebarProvider>
  );
}
