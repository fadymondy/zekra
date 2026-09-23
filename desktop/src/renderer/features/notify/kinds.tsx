import { Bell, BellRing, BrainCircuit, Download, Presentation, type LucideIcon } from "lucide-react";

import { kindVisual, type KindVisual } from "@mobile/features/notify/notify-core";

import { cn } from "@/lib/utils";

/** Same tiles as the web bell (web/components/shell/notification-bell.tsx). */
const VISUALS: Record<KindVisual, { icon: LucideIcon; tone: string }> = {
  brain: { icon: BrainCircuit, tone: "border-grid-gold/60 bg-grid-gold/10 text-grid-gold" },
  presentation: { icon: Presentation, tone: "border-grid-action/60 bg-grid-action/10 text-grid-action" },
  download: { icon: Download, tone: "border-grid-action/60 bg-grid-action/10 text-grid-action" },
  test: { icon: BellRing, tone: "border-grid-ok/60 bg-grid-ok/10 text-grid-ok" },
  info: { icon: Bell, tone: "border-line text-grid-muted" },
};

export function KindTile({ kind, className }: { kind: string; className?: string }) {
  const v = VISUALS[kindVisual(kind)];
  const Icon = v.icon;
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", v.tone, className)}>
      <Icon className="size-4" />
    </span>
  );
}
