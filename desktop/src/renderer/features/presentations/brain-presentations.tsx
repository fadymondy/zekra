import { useCallback, useEffect, useState } from "react";
import { Check, Eye, Link2, ListFilter, Loader2, Plus, Presentation, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KINDS, STATUSES, customerLine } from "@mobile/features/presentations/presentations-core";
import type { PKind, PStatus, Summary } from "@mobile/features/presentations/types";

import type { Brain } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useAuthed } from "../../shell/session";
import { presentationsApi } from "./api";
import { CreateFromBrainDialog } from "./create-dialog";
import { useDebounced, useFormat } from "./format";
import { KindTile, LocaleChips, StatusChip, ToggleChip } from "./parts";
import { PresentationDetail } from "./presentation-detail";

type KindFilter = PKind | "all";
type StatusFilter = PStatus | "all";

/*
The "Presentations" tab of a brain (MH-450), ported from mobile's
brain-presentations.tsx: the brain's decks, reports and pages, searchable by
title/customer, filtered by kind (strip) and status (menu), with "Create from
brain" for editors. On desktop it is a split view — the list on the start
side, the selected presentation's detail beside it.
*/
export function BrainPresentations({ brain }: { brain: Brain }) {
  const { t } = useI18n();
  const f = useFormat();
  const { token } = useAuthed();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const q = useDebounced(search.trim(), 300);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await presentationsApi.list(token, { namespace: brain.namespace, q, kind, status, limit: 200 });
      setItems(out.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("kit.error"));
    } finally {
      setLoading(false);
    }
  }, [token, brain.namespace, q, kind, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A different brain starts with nothing selected.
  useEffect(() => {
    setSelected(null);
    setItems(null);
    setSearch("");
    setKind("all");
    setStatus("all");
  }, [brain.namespace]);

  const list = items ?? [];
  const filtered = !!q || kind !== "all" || status !== "all";

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={cn("flex min-h-0 flex-col border-e border-line bg-grid-bg", selected ? "w-[380px] shrink-0" : "flex-1")}>
        <div className="flex flex-col gap-2.5 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" strokeWidth={1.6} />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("presentations.search")} className="ps-8" spellCheck={false} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className={cn(status !== "all" && "border-grid-gold text-grid-gold")} aria-label={t("presentations.filter.status")} />
                }
              >
                <ListFilter />
                {status === "all" ? t("presentations.status.any") : f.status(status)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                {(["all", ...STATUSES] as StatusFilter[]).map((s) => (
                  <DropdownMenuItem key={s} onClick={() => setStatus(s)}>
                    <Check className={cn(s === status ? "text-grid-gold" : "invisible")} />
                    {s === "all" ? t("presentations.status.any") : f.status(s)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon-sm" aria-label={t("action.refresh")} disabled={loading} onClick={() => void load()}>
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", ...KINDS] as KindFilter[]).map((k) => (
              <ToggleChip key={k} on={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? t("presentations.kind.all") : f.kind(k)}
              </ToggleChip>
            ))}
            <span className="flex-1" />
            {brain.canWrite ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                {t("presentations.create")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null && !error ? (
            <div className="flex justify-center p-6 text-grid-muted">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : null}
          {error ? (
            <div className="flex flex-col items-start gap-2 p-4">
              <p className="text-sm text-grid-danger">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("kit.retry")}
              </Button>
            </div>
          ) : null}
          {items !== null && !error && list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-md border border-line bg-grid-card text-grid-muted">
                <Presentation className="size-5" />
              </span>
              <p className="text-sm text-grid-muted">{filtered ? t("presentations.emptyFiltered") : t("presentations.empty")}</p>
            </div>
          ) : null}
          {list.length ? (
            <ul className="divide-y divide-line">
              {list.map((item) => (
                <PresentationRow key={item.id} item={item} active={item.id === selected} onOpen={() => setSelected(item.id)} />
              ))}
            </ul>
          ) : null}
        </div>
        {list.length ? (
          <div className="grid-micro border-t border-line px-3 py-1.5 text-grid-muted">{t("desk.pres.count", { n: list.length })}</div>
        ) : null}
      </aside>

      {selected ? (
        <PresentationDetail
          key={selected}
          id={selected}
          token={token}
          canWrite={brain.canWrite}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
          onDeleted={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : null}

      {brain.canWrite ? (
        <CreateFromBrainDialog
          brain={brain}
          token={token}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(ids) => {
            void load();
            if (ids[0]) setSelected(ids[0]);
          }}
        />
      ) : null}
    </div>
  );
}

/** One presentation in the list: kind tile, title, kind · customer, then
 *  languages · status · live links · views (+ when last viewed). */
function PresentationRow({ item, active, onOpen }: { item: Summary; active: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const who = customerLine(item.customer);
  const viewed = f.ago(item.last_viewed_at);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex w-full flex-col gap-2 px-3 py-3 text-start transition-colors hover:bg-grid-soft focus-visible:bg-grid-soft focus-visible:outline-none",
          active && "bg-grid-soft",
        )}
      >
        {/* Gold selection rule on the start edge. */}
        {active ? <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-grid-gold" /> : null}
        <div className="flex items-center gap-3">
          <KindTile kind={item.kind} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium text-grid-fg" style={{ unicodeBidi: "plaintext" }}>
              {item.title || t("notes.untitled")}
            </p>
            <p className="truncate text-xs text-grid-muted">{[f.kind(item.kind), who].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 ps-12">
          <LocaleChips locales={item.locales} />
          <StatusChip status={item.status} />
          <span className={cn("inline-flex items-center gap-1 font-mono text-[11px]", item.active_shares ? "text-grid-gold" : "text-grid-muted")}>
            <Link2 className="size-3" strokeWidth={1.8} />
            {item.active_shares}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-grid-muted">
            <Eye className="size-3" strokeWidth={1.8} />
            {viewed ? t("presentations.viewsAgo", { n: item.view_count, when: viewed }) : String(item.view_count)}
          </span>
        </div>
      </button>
    </li>
  );
}
