import { Outlet, useNavigate, useParams, useRouterState, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Network, Search, Rocket, Lock, HelpCircle, KeyRound, Activity,
  ChevronRight, ChevronsUpDown, MessagesSquare, Plug,
} from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarInset, SidebarTrigger, ThemePicker,
} from "@togo-framework/ui";
import { LiveIndicator } from "../lib/realtime";
import { SidebarBrand, MemorySquare } from "../components/brand";
import { UserMenu } from "../components/chrome";
import { brainApi } from "../lib/brain";
import { useSidebarState } from "../lib/sidebar";

// The brain workspace is a scoped surface: every section below is bound to the
// $namespace in the URL. Overview (the graph) is the flagship index. Sources
// (data-source connectors) feed knowledge into the brain.
const SECTIONS = [
  { seg: "", to: "/b/$namespace", label: "Overview", icon: Network },
  { seg: "chat", to: "/b/$namespace/chat", label: "Chat", icon: MessagesSquare },
  { seg: "search", to: "/b/$namespace/search", label: "Search", icon: Search },
  { seg: "sources", to: "/b/$namespace/sources", label: "Sources", icon: Plug },
  { seg: "sessions", to: "/b/$namespace/sessions", label: "Sessions", icon: Rocket },
  { seg: "secrets", to: "/b/$namespace/secrets", label: "Secrets", icon: Lock },
  { seg: "gaps", to: "/b/$namespace/gaps", label: "Gaps", icon: HelpCircle },
  { seg: "permissions", to: "/b/$namespace/permissions", label: "Permissions", icon: KeyRound },
  { seg: "activity", to: "/b/$namespace/activity", label: "Activity", icon: Activity },
] as const;

export function BrainWorkspaceLayout() {
  const nav = useNavigate();
  const { namespace } = useParams({ strict: false }) as { namespace: string };
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const base = `/b/${namespace}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : "";
  const current = SECTIONS.find((s) => s.seg === rest) ?? SECTIONS[0];

  const namespaces = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces });
  const brains = namespaces.data?.brains ?? [];

  const isActive = (seg: string) => (seg === "" ? pathname === base : rest === seg);
  const sidebar = useSidebarState();

  return (
    <SidebarProvider open={sidebar.open} onOpenChange={sidebar.setOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarBrand title="Back to Brains" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            {/* The brain in scope, marked with the brand's memory square. */}
            <SidebarGroupLabel className="gap-2 truncate">
              <span className="inline-flex min-w-0 items-center gap-2">
                <MemorySquare />
                <span className="truncate">Brain · {namespace}</span>
              </span>
            </SidebarGroupLabel>
            <SidebarMenu>
              {SECTIONS.map((s) => (
                <SidebarMenuItem key={s.label}>
                  <SidebarMenuButton
                    isActive={isActive(s.seg)}
                    tooltip={s.label}
                    onClick={() => nav({ to: s.to, params: { namespace } })}
                  >
                    <s.icon className="h-4 w-4" />
                    <span>{s.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {/* min-w-0: the inset is a flex item, so without it any wide child (the header on a
          phone, a long table) would stretch the whole shell past the viewport. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            {/* Breadcrumb — on a phone only the brain switcher stays; the page heading
                names the section. */}
            <nav className="flex min-w-0 items-center gap-1.5 text-sm">
              <Link to="/" className="hidden text-muted-foreground hover:text-foreground sm:inline">Brains</Link>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block rtl:-scale-x-100" />
              {/* Brain switcher */}
              <div className="relative inline-flex min-w-0 items-center">
                <MemorySquare className="pointer-events-none absolute start-2.5" />
                <select
                  value={namespace}
                  onChange={(e) => nav({ to: current.to, params: { namespace: e.target.value } })}
                  className="w-full min-w-0 max-w-[140px] appearance-none truncate rounded-md border border-border bg-background py-1.5 ps-7 pe-7 text-sm font-medium text-foreground outline-none sm:max-w-[180px]"
                  title="Switch brain"
                >
                  {brains.length === 0 && <option value={namespace}>{namespace}</option>}
                  {brains.map((b) => (
                    <option key={b.namespace} value={b.namespace}>{b.namespace}</option>
                  ))}
                </select>
                <ChevronsUpDown className="pointer-events-none absolute end-2 h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block rtl:-scale-x-100" />
              <span className="hidden truncate font-medium text-foreground sm:inline">{current.label}</span>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
