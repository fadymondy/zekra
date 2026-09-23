import { forwardRef, useCallback, useRef, type ComponentProps, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
Small pieces of desktop chrome, built on the web's shadcn components:

  IconButton    a ghost icon button with a tooltip (label + shortcut). Every
                icon-only control in the app goes through it, so all of them
                are labelled, sized (28px) and hover the same way.
  PaneResizer   a 1px hairline between two panes with a wide invisible grip;
                drags a PIXEL width, logical (RTL-aware), double-click resets.
  SectionLabel  the small muted header over a group of rows.
*/

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  label: string;
  shortcut?: string;
  children: ReactNode;
  size?: "icon-xs" | "icon-sm" | "icon";
  side?: "top" | "bottom" | "inline-start" | "inline-end";
  active?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, children, size = "icon-sm", side = "bottom", active, className, ...props },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            variant="ghost"
            size={size}
            data-ctl={size}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-selected aria-pressed:bg-selected aria-pressed:text-foreground dark:hover:bg-hover [&_svg]:stroke-[1.75]",
              size === "icon-sm" && "[&_svg:not([class*='size-'])]:size-4",
              className,
            )}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
});

export function SectionLabel({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn("flex h-7 items-center gap-2 px-2 text-[11px] font-semibold text-muted-foreground", className)}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action}
    </div>
  );
}

/**
 * A vertical drag handle on the END edge of a pane of `width` px. Dragging
 * toward the end grows it (mirrored in RTL). Double-click restores `reset`.
 */
export function PaneResizer({ width, min, max, reset, onWidth, onDone, label, className }: {
  width: number;
  min: number;
  max: number;
  reset: number;
  onWidth: (w: number) => void;
  onDone?: (w: number) => void;
  label: string;
  className?: string;
}) {
  const start = useRef<{ x: number; w: number; rtl: boolean; last: number } | null>(null);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
      start.current = { x: e.clientX, w: width, rtl, last: width };
      const move = (ev: PointerEvent) => {
        const s = start.current;
        if (!s) return;
        const dx = (ev.clientX - s.x) * (s.rtl ? -1 : 1);
        s.last = Math.round(Math.max(min, Math.min(max, s.w + dx)));
        onWidth(s.last);
      };
      const up = () => {
        const last = start.current?.last ?? width;
        start.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        delete document.body.dataset.resizing;
        onDone?.(last);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.dataset.resizing = "true";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [width, min, max, onWidth, onDone],
  );
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        onWidth(reset);
        onDone?.(reset);
      }}
      className={cn("group absolute inset-y-0 -end-1 z-20 w-2 cursor-col-resize", className)}
    >
      <span className="absolute inset-y-0 start-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-ring/60 group-active:bg-ring rtl:translate-x-1/2" />
    </div>
  );
}
