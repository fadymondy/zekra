import { forwardRef, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

import { cn } from "@/lib/utils";

import { IconButton } from "../../components/chrome";
import { useI18n } from "../../lib/i18n";
import type { OutlineItem } from "./outline";

/*
The editor's own chrome: the find bar, the outline rail and a drag divider
shared by split panes. There is no mode switch: a note is always the live
editor (Apple Notes style); its markdown source is a secondary view
(View ▸ View Markdown Source, or the note's "…" menu).
*/

export const FindBar = forwardRef<HTMLInputElement, {
  query: string;
  onQuery: (q: string) => void;
  count: number;
  index: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}>(function FindBar({ query, onQuery, count, index, onNext, onPrev, onClose }, ref) {
  const { t } = useI18n();
  return (
    <div className="app-chrome flex items-center gap-1 border-b border-border/60 bg-background px-3 py-1.5">
      <InputGroup className="h-7 max-w-md rounded-md border-border/80 bg-muted/50 dark:bg-muted/50">
        <InputGroupAddon className="ps-2 [&>svg]:size-3.5">
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={ref}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={t("ws.find.placeholder")}
          aria-label={t("ws.find.placeholder")}
          className="h-7 text-[14px]"
        />
        <InputGroupAddon align="inline-end" className="pe-2 text-[12.5px] font-normal tabular-nums">
          {query ? (count ? t("ws.find.count", { i: index + 1, n: count }) : t("ws.find.none")) : ""}
        </InputGroupAddon>
      </InputGroup>
      <IconButton size="icon-xs" label={t("ws.find.prev")} shortcut="⇧↩" onClick={onPrev} disabled={!count}>
        <ChevronUp />
      </IconButton>
      <IconButton size="icon-xs" label={t("ws.find.next")} shortcut="↩" onClick={onNext} disabled={!count}>
        <ChevronDown />
      </IconButton>
      <div className="flex-1" />
      <IconButton size="icon-xs" label={t("ws.find.close")} shortcut="esc" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );
});

export function OutlineRail({ items, active, onPick }: { items: OutlineItem[]; active: number; onPick: (item: OutlineItem) => void }) {
  const { t } = useI18n();
  const min = items.reduce((m, it) => Math.min(m, it.depth), 6);
  return (
    <nav aria-label={t("ws.outline")} className="app-chrome flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-4 pt-4 pb-1.5 text-[12.5px] font-semibold text-muted-foreground">{t("ws.outline")}</p>
      {items.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">{t("ws.outline.empty")}</p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {items.map((it) => (
            <li key={it.index}>
              <button
                type="button"
                onClick={() => onPick(it)}
                title={it.text}
                className={cn(
                  "relative block w-full truncate rounded-md py-1 pe-2 text-start text-[13px] transition-colors",
                  it.index === active ? "bg-hover font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
                style={{ paddingInlineStart: 8 + (it.depth - min) * 12 }}
              >
                {/* The heading's own direction; the indent follows the UI. */}
                <span dir="auto" className="block truncate" style={{ unicodeBidi: "plaintext" }}>
                  {it.text}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

/**
 * A vertical drag handle between two panes. Reports the new ratio (0.15–0.85)
 * of the START pane within `container`, logical (RTL-aware).
 */
export function SplitDivider({ container, onRatio, onDone }: {
  container: () => HTMLElement | null;
  onRatio: (ratio: number) => void;
  onDone?: () => void;
}) {
  const dragging = useRef(false);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = container();
      if (!el) return;
      e.preventDefault();
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rtl = getComputedStyle(el).direction === "rtl";
      const move = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const r = el.getBoundingClientRect();
        const x = rtl ? r.right - ev.clientX : ev.clientX - r.left;
        onRatio(Math.max(0.15, Math.min(0.85, x / r.width)));
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        onDone?.();
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [container, onRatio, onDone],
  );
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-border/60"
    >
      <span className="absolute inset-y-0 -start-1 -end-1 transition-colors group-hover:bg-ring/40" />
    </div>
  );
}
