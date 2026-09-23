import { memo, type ReactNode } from "react";
import {
  Activity,
  CircleCheck,
  Database,
  CircleHelp,
  Download,
  Ellipsis,
  FolderOpen,
  KeyRound,
  NotebookText,
  Presentation,
  Trash2,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  brainName,
  canDelete,
  formatAgo,
  formatCount,
  topTypes,
  type BrainListItem,
} from "@mobile/features/brains/brains-core";

import { BrainAvatar } from "../../components/brain-avatar";
import { useI18n, type TKey } from "../../lib/i18n";
import type { BrainTab } from "../../shell/router";
import { useBrainDetail } from "./brains-data";

/*
A brain on the Brains home — the web's BrainCard / mobile's brain-card.tsx:
a 2px rule in the brain's colour on top (the house violet at reduced opacity
when it has none); avatar, name + role, namespace · last update; two lines of
description; memories · recalls · types; the top entity types; open gaps and
"Open". Per-brain detail loads lazily per card.

Its actions live in BOTH a right-click menu and the "…" button (same list).
*/

const ROLE_KEYS: Record<string, TKey> = {
  admin: "brains.role.admin",
  owner: "brains.role.owner",
  editor: "brains.role.editor",
  viewer: "brains.role.viewer",
};

export type BrainAction = "open" | BrainTab | "export" | "delete";

type ActionDef = { id: BrainAction; label: string; icon: ReactNode; destructive?: boolean; sepBefore?: boolean };

function useActions(brain: BrainListItem): ActionDef[] {
  const { t } = useI18n();
  const list: ActionDef[] = [
    { id: "open", label: t("brains.menu.open"), icon: <FolderOpen /> },
    { id: "notes", label: t("brains.menu.notes"), icon: <NotebookText />, sepBefore: true },
    { id: "presentations", label: t("brains.menu.presentations"), icon: <Presentation /> },
    { id: "vault", label: t("brains.menu.vault"), icon: <KeyRound /> },
    { id: "export", label: t("brains.menu.export"), icon: <Download />, sepBefore: true },
  ];
  if (canDelete(brain.role)) list.push({ id: "delete", label: t("brains.menu.delete"), icon: <Trash2 />, destructive: true, sepBefore: true });
  return list;
}

function Tag({ children, hue, className }: { children: ReactNode; hue?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] leading-4 text-foreground/80", className)}
      style={hue ? { backgroundColor: `color-mix(in oklab, ${hue} 16%, transparent)`, color: hue } : undefined}
    >
      {children}
    </span>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground" title={label}>
      <span className="flex shrink-0 [&_svg]:size-3.5 [&_svg]:stroke-[1.75]">{icon}</span>
      <span dir="ltr" className="font-medium text-foreground/85 tabular-nums">
        {value}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export const BrainCard = memo(function BrainCard({ brain, token, onAction }: {
  brain: BrainListItem;
  token: string;
  onAction: (brain: BrainListItem, action: BrainAction) => void;
}) {
  const { t, locale } = useI18n();
  const detail = useBrainDetail(brain.namespace).data;
  const name = brainName(brain);
  const types = topTypes(detail?.types);
  const roleKey = brain.role ? ROLE_KEYS[brain.role] : undefined;
  const actions = useActions(brain);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            aria-label={t("brains.openBrain", { brain: name })}
            onClick={() => onAction(brain, "open")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAction(brain, "open");
              }
            }}
            className="group relative flex min-h-44 cursor-default flex-col gap-3 rounded-xl border border-border/70 bg-pane-raised p-4 text-start transition-colors outline-none hover:border-border hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-hover"
          />
        }
      >
        <div className="flex items-start gap-3">
          <BrainAvatar brain={brain} token={token} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-foreground" style={{ unicodeBidi: "plaintext" }}>
                {name}
              </span>
              {roleKey ? <Tag className="shrink-0">{t(roleKey)}</Tag> : null}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {name !== brain.namespace ? (
                <>
                  <bdi>{brain.namespace}</bdi>
                  {" · "}
                </>
              ) : null}
              {t("brains.updated", { when: formatAgo(brain.lastAt, locale) })}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={t("brains.menu.label", { brain: name })}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="-me-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-selected hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:bg-selected aria-expanded:opacity-100"
                />
              }
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52" onClick={(e) => e.stopPropagation()}>
              {actions.map((a) => (
                <span key={a.id} className="contents">
                  {a.sepBefore ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem variant={a.destructive ? "destructive" : "default"} onClick={() => onAction(brain, a.id)}>
                    {a.icon}
                    {a.label}
                  </DropdownMenuItem>
                </span>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {brain.description ? (
          <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground" dir="auto">
            {brain.description}
          </p>
        ) : null}

        <div className="flex min-h-5 flex-wrap items-center gap-1">
          {!detail ? (
            <>
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-12 rounded-md" />
            </>
          ) : types.top.length === 0 ? null : (
            <>
              {types.top.map(([type, n]) => (
                <Tag key={type}>
                  <span className="truncate">{type}</span>
                  <span dir="ltr" className="text-muted-foreground tabular-nums">
                    {formatCount(n)}
                  </span>
                </Tag>
              ))}
              {types.rest > 0 ? (
                <span dir="ltr" className="px-1 text-[11px] text-muted-foreground">
                  +{types.rest}
                </span>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-auto flex items-center gap-4 border-t border-border/60 pt-3">
          <Stat icon={<Database />} value={formatCount(brain.memories)} label={t("brains.metric.memories")} />
          <Stat icon={<Activity />} value={detail ? formatCount(detail.recalls) : "—"} label={t("brains.metric.recalls")} />
          <div className="ms-auto">
            {!detail ? null : detail.openGaps > 0 ? (
              <Tag hue="var(--grid-warn)">
                <CircleHelp className="size-3" />
                {detail.openGaps === 1 ? t("brains.openGapOne") : t("brains.openGapMany", { count: formatCount(detail.openGaps) })}
              </Tag>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <CircleCheck className="size-3.5 text-grid-ok" />
                {t("brains.noGaps")}
              </span>
            )}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-52">
        {actions.map((a) => (
          <span key={a.id} className="contents">
            {a.sepBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem variant={a.destructive ? "destructive" : "default"} onClick={() => onAction(brain, a.id)}>
              {a.icon}
              {a.label}
            </ContextMenuItem>
          </span>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});
