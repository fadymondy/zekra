import { Bell, BrainCircuit, Presentation, Search, Settings as SettingsIcon, type LucideIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useI18n, type TKey } from "../lib/i18n";
import type { Route } from "./router";
import { useRouter } from "./router";
import { useSession } from "./session";

/*
The activity bar: the app's primary navigation, a narrow icon column on the
START side (right in Arabic). Feature teams add an entry by appending to
ACTIVITY_ITEMS — the shell renders, highlights and tooltips it.

  id        stable key
  label     i18n key for the tooltip / aria-label
  icon      lucide icon
  to        the route to open (gets the session, e.g. to reach the open brain)
  match     is this entry "current" for the route?
  placement top group or pinned to the bottom
*/

type ActivityItem = {
  id: string;
  label: TKey;
  icon: LucideIcon;
  to: (ctx: { activeBrain: string | null }) => Route;
  match: (route: Route) => boolean;
  placement: "top" | "bottom";
};

export const ACTIVITY_ITEMS: ActivityItem[] = [
  {
    id: "brains",
    label: "nav.brains",
    icon: BrainCircuit,
    to: () => ({ name: "brains" }),
    match: (r) => r.name === "brains" || (r.name === "brain" && r.tab !== "presentations"),
    placement: "top",
  },
  {
    id: "search",
    label: "nav.search",
    icon: Search,
    to: () => ({ name: "search" }),
    match: (r) => r.name === "search",
    placement: "top",
  },
  {
    id: "presentations",
    label: "nav.presentations",
    icon: Presentation,
    to: ({ activeBrain }) => (activeBrain ? { name: "brain", ns: activeBrain, tab: "presentations" } : { name: "brains" }),
    match: (r) => r.name === "brain" && r.tab === "presentations",
    placement: "top",
  },
  {
    id: "notifications",
    label: "nav.notifications",
    icon: Bell,
    to: () => ({ name: "notifications" }),
    match: (r) => r.name === "notifications",
    placement: "top",
  },
  {
    id: "settings",
    label: "nav.settings",
    icon: SettingsIcon,
    to: () => ({ name: "settings", section: "general" }),
    match: (r) => r.name === "settings",
    placement: "bottom",
  },
];

export const ACTIVITY_BAR_WIDTH = 52;

export function ActivityBar() {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const { settings } = useSession();

  const button = (item: ActivityItem) => {
    const active = item.match(route);
    const Icon = item.icon;
    return (
      <Tooltip key={item.id}>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={t(item.label)}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(item.to({ activeBrain: settings.activeBrain }))}
              className={cn(
                "relative flex size-10 items-center justify-center rounded-md text-grid-muted transition-colors hover:bg-grid-soft hover:text-grid-fg focus-visible:outline-2 focus-visible:outline-grid-action",
                active && "bg-grid-soft text-grid-fg",
              )}
            />
          }
        >
          {/* The active marker hugs the START edge (logical, so RTL-correct). */}
          {active ? <span aria-hidden className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-grid-action" /> : null}
          <Icon className="size-[18px]" />
        </TooltipTrigger>
        <TooltipContent side="inline-end">{t(item.label)}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav
      aria-label={t("nav.primary")}
      className="flex shrink-0 flex-col items-center gap-1 border-e border-line bg-grid-bg py-2"
      style={{ width: ACTIVITY_BAR_WIDTH }}
    >
      {ACTIVITY_ITEMS.filter((i) => i.placement === "top").map(button)}
      <div className="flex-1" />
      {ACTIVITY_ITEMS.filter((i) => i.placement === "bottom").map(button)}
    </nav>
  );
}
