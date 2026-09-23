import { forwardRef, useCallback, useRef, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpen, ChevronDown, ChevronUp, Code2, Columns2, PenLine, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { useI18n, type TKey } from "../../lib/i18n";
import type { OutlineItem } from "./outline";

/*
The editor's own chrome: the mode switch (Live / Source / Split / Preview —
Mark It Down's View/Split/Edit, plus the live WYSIWYG as the default), the
find bar, the outline rail and a drag divider shared by the split panes.
*/

export type EditorMode = "live" | "source" | "split" | "preview";
export const EDITOR_MODES: EditorMode[] = ["live", "source", "split", "preview"];

const MODE_META: Record<EditorMode, { key: TKey; Icon: ComponentType<{ className?: string }> }> = {
  live: { key: "ws.mode.live", Icon: PenLine },
  source: { key: "ws.mode.source", Icon: Code2 },
  split: { key: "ws.mode.split", Icon: Columns2 },
  preview: { key: "ws.mode.preview", Icon: BookOpen },
};

const MODE_KEY = "zekra.desktop.editor-mode";
export function loadMode(): EditorMode {
  const m = localStorage.getItem(MODE_KEY) as EditorMode | null;
  return m && EDITOR_MODES.includes(m) ? m : "live";
}
export function saveMode(m: EditorMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* non-fatal */
  }
}

export function ModeSwitch({ mode, onChange }: { mode: EditorMode; onChange: (m: EditorMode) => void }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("ws.mode.label")} className="flex items-center rounded-lg border border-line bg-grid-card p-0.5">
      {EDITOR_MODES.map((m) => {
        const { key, Icon } = MODE_META[m];
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            title={t(key)}
            onClick={() => onChange(m)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
              mode === m ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden lg:inline">{t(key)}</span>
          </button>
        );
      })}
    </div>
  );
}

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
    <div className="flex items-center gap-1.5 border-b border-line bg-grid-card px-3 py-1.5">
      <input
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
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-grid-bg px-2 text-sm text-grid-fg outline-none focus:border-grid-action"
      />
      <span className="w-20 shrink-0 text-center text-[11px] text-grid-muted tabular-nums">
        {query ? (count ? t("ws.find.count", { i: index + 1, n: count }) : t("ws.find.none")) : ""}
      </span>
      <button type="button" aria-label={t("ws.find.prev")} title={t("ws.find.prev")} onClick={onPrev} disabled={!count} className="rounded-sm p-1 text-grid-muted hover:bg-grid-soft hover:text-grid-fg disabled:opacity-40">
        <ChevronUp className="size-4" />
      </button>
      <button type="button" aria-label={t("ws.find.next")} title={t("ws.find.next")} onClick={onNext} disabled={!count} className="rounded-sm p-1 text-grid-muted hover:bg-grid-soft hover:text-grid-fg disabled:opacity-40">
        <ChevronDown className="size-4" />
      </button>
      <button type="button" aria-label={t("ws.find.close")} title={t("ws.find.close")} onClick={onClose} className="rounded-sm p-1 text-grid-muted hover:bg-grid-soft hover:text-grid-fg">
        <X className="size-4" />
      </button>
    </div>
  );
});

export function OutlineRail({ items, active, onPick }: { items: OutlineItem[]; active: number; onPick: (item: OutlineItem) => void }) {
  const { t } = useI18n();
  const min = items.reduce((m, it) => Math.min(m, it.depth), 6);
  return (
    <nav aria-label={t("ws.outline")} className="flex h-full min-h-0 flex-col">
      <p className="grid-micro shrink-0 px-3 pt-3 pb-2 text-grid-muted">{t("ws.outline")}</p>
      {items.length === 0 ? (
        <p className="px-3 text-xs text-grid-muted">{t("ws.outline.empty")}</p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto pb-3">
          {items.map((it) => (
            <li key={it.index}>
              <button
                type="button"
                onClick={() => onPick(it)}
                title={it.text}
                className={cn(
                  "relative block w-full truncate py-1 pe-3 text-start text-xs transition-colors",
                  it.index === active ? "font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg",
                )}
                style={{ paddingInlineStart: 12 + (it.depth - min) * 12, unicodeBidi: "plaintext" }}
              >
                {it.index === active ? <span aria-hidden className="absolute inset-y-1 start-0 w-0.5 rounded-full bg-grid-gold" /> : null}
                {it.text}
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
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line"
    >
      <span className="absolute inset-y-0 -start-1 -end-1 transition-colors group-hover:bg-grid-action/40" />
    </div>
  );
}
