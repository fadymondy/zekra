import { memo, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
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
import { cn } from "@/lib/utils";

import {
  brainHex,
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
      className={cn("inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-4", className)}
      style={{
        borderColor: hue ? `${hue}55` : "var(--grid-line)",
        backgroundColor: hue ? `${hue}1A` : "var(--grid-card)",
        color: hue ?? "var(--grid-body)",
      }}
    >
      {children}
    </span>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className="min-w-0 px-4 py-2.5 first:ps-4">
      <span dir="ltr" className="block truncate font-mono text-[15px] text-grid-fg tabular-nums">
        {value}
      </span>
      <span className="grid-micro block truncate text-grid-muted">{label}</span>
    </span>
  );
}

export const BrainCard = memo(function BrainCard({ brain, token, onAction }: {
  brain: BrainListItem;
  token: string;
  onAction: (brain: BrainListItem, action: BrainAction) => void;
}) {
  const { t, locale, isRtl } = useI18n();
  const detail = useBrainDetail(brain.namespace).data;
  const hex = brainHex(brain);
  const name = brainName(brain);
  const types = topTypes(detail?.types);
  const roleKey = brain.role ? ROLE_KEYS[brain.role] : undefined;
  const actions = useActions(brain);
  const Forward = isRtl ? ArrowLeft : ArrowRight;

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
            className="group relative flex cursor-default flex-col bg-grid-card text-start transition-colors outline-none hover:bg-grid-soft focus-visible:bg-grid-soft focus-visible:ring-2 focus-visible:ring-grid-action/50 focus-visible:ring-inset"
          />
        }
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: hex || "var(--grid-action)", opacity: hex ? 0.85 : 0.5 }}
        />

        <div className="flex items-start gap-3 p-4 pb-3">
          <BrainAvatar brain={brain} token={token} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-medium text-grid-fg" style={{ unicodeBidi: "plaintext" }}>
                {name}
              </span>
              {roleKey ? <Tag>{t(roleKey)}</Tag> : null}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-grid-muted">
              {name !== brain.namespace ? (
                <>
                  <bdi className="font-mono text-[11px]">{brain.namespace}</bdi>
                  {"  ·  "}
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
                  className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-grid-muted opacity-70 transition hover:bg-grid-card hover:text-grid-fg group-hover:opacity-100"
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
          <p className="line-clamp-2 px-4 pb-3 text-[13px] leading-5 font-light text-grid-body">{brain.description}</p>
        ) : null}

        <div className="mt-auto grid grid-cols-3 divide-x divide-line border-y border-line rtl:divide-x-reverse">
          <Metric value={formatCount(brain.memories)} label={t("brains.metric.memories")} />
          <Metric value={detail ? formatCount(detail.recalls) : "—"} label={t("brains.metric.recalls")} />
          <Metric value={detail ? formatCount(Object.keys(detail.types ?? {}).length) : "—"} label={t("brains.metric.types")} />
        </div>

        <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-4 py-2.5">
          {!detail ? (
            <>
              <span className="h-5 w-16 animate-pulse rounded-md bg-grid-soft" />
              <span className="h-5 w-12 animate-pulse rounded-md bg-grid-soft" />
              <span className="h-5 w-14 animate-pulse rounded-md bg-grid-soft" />
            </>
          ) : types.top.length === 0 ? (
            <span className="text-xs text-grid-muted">{t("brains.noTypes")}</span>
          ) : (
            <>
              {types.top.map(([type, n]) => (
                <Tag key={type}>
                  <span className="truncate">{type}</span>
                  <span dir="ltr" className="font-mono text-[10.5px] text-grid-muted">
                    {formatCount(n)}
                  </span>
                </Tag>
              ))}
              {types.rest > 0 ? (
                <span dir="ltr" className="font-mono text-[11px] text-grid-muted">
                  +{types.rest}
                </span>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {!detail ? null : detail.openGaps > 0 ? (
              <Tag hue="#C9A227">
                <CircleHelp className="size-3" />
                {detail.openGaps === 1 ? t("brains.openGapOne") : t("brains.openGapMany", { count: formatCount(detail.openGaps) })}
              </Tag>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-grid-muted">
                <CircleCheck className="size-3.5 text-grid-ok" />
                {t("brains.noGaps")}
              </span>
            )}
          </div>
          <span className="flex items-center gap-1 text-[13px] text-grid-muted transition-colors group-hover:text-grid-fg">
            {t("brains.open")}
            <Forward className="size-3.5" />
          </span>
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
