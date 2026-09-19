import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowLeft, Check, ChevronsUpDown, HelpCircle, KeyRound, Lock,
  MessagesSquare, Network, Plug, Rocket, Search,
} from "lucide-react";
import {
  Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@togo-framework/ui";
import { AppShell, type NavGroup } from "../components/app-shell";
import { brainApi } from "../lib/brain";

// The brain workspace: every section is bound to the $namespace in the URL. The header's
// brain switcher mirrors Managy's workspace switcher and keeps the current section.
function groupsFor(namespace: string): NavGroup[] {
  const b = `/b/${namespace}`;
  return [
    {
      items: [
        { to: b, label: "Overview", icon: Network, exact: true },
        { to: `${b}/chat`, label: "Chat", icon: MessagesSquare },
        { to: `${b}/search`, label: "Search", icon: Search },
        { to: `${b}/sources`, label: "Sources", icon: Plug },
        { to: `${b}/sessions`, label: "Sessions", icon: Rocket },
        { to: `${b}/gaps`, label: "Gaps", icon: HelpCircle },
        { to: `${b}/activity`, label: "Activity", icon: Activity },
      ],
    },
    {
      label: "Settings",
      items: [
        { to: `${b}/secrets`, label: "Secrets", icon: Lock },
        { to: `${b}/permissions`, label: "Permissions", icon: KeyRound },
      ],
    },
  ];
}

function BrainSwitcher({ namespace }: { namespace: string }) {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const namespaces = useQuery({ queryKey: ["brain", "namespaces"], queryFn: brainApi.namespaces });
  const brains = namespaces.data?.brains ?? [];

  // Switching keeps the section (chat, sources…), which exists in every brain.
  const prefix = `/b/${namespace}`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 max-w-[9rem] justify-between gap-2 px-2.5 sm:max-w-[16rem]" aria-label="Switch brain">
          <span className="flex size-6 shrink-0 items-center justify-center border border-line bg-grid-card text-xs font-medium text-grid-brand">
            {namespace.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden truncate text-sm font-medium sm:inline">{namespace}</span>
          <ChevronsUpDown className="h-4 w-4 text-grid-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-64 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Brains</DropdownMenuLabel>
          {brains.map((b) => (
            <DropdownMenuItem key={b.namespace} onSelect={() => nav({ to: `/b/${b.namespace}${rest}` })}>
              <span className="min-w-0 flex-1 truncate">{b.namespace}</span>
              <span className="num text-xs text-grid-muted">{b.memories.toLocaleString()}</span>
              {b.namespace === namespace ? <Check className="h-4 w-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav({ to: "/" })}>
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> All brains
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BrainWorkspaceLayout() {
  const { namespace } = useParams({ strict: false }) as { namespace: string };
  return <AppShell groups={groupsFor(namespace)} start={<BrainSwitcher namespace={namespace} />} />;
}
