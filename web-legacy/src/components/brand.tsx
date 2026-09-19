// Zekra's identity on the grid (fadymondy.com's design system), from Zekra Brand.dc.html.
// Marks are drawn from the grid's generated copy of web/lib/brand/marks.ts — never copy cells
// by hand. With tone="auto" the colours come from the grid tokens, so the product's own mark
// follows light/dark by itself: --grid-brand is violet #6d4de6 on ivory and ivory #f0ebe1 on
// indigo; the dome top is gold.
import { Link } from "@tanstack/react-router";
import { FADY_MONDY_MARK, PRODUCT_MARKS, type MarkSpec } from "../styles/grid-marks";

export const ZEKRA_MARK: MarkSpec = PRODUCT_MARKS.cabrain;
export { FADY_MONDY_MARK };

type CubeMarkProps = {
  mark?: MarkSpec;
  /** Rendered width in px; height follows the mark's own proportions. */
  size?: number;
  /**
   * auto     — grid tokens (theme-aware). Only meaningful for Zekra's own mark, since
   *            --grid-brand is set by <html data-brand="cabrain">.
   * on-dark  — the mark's own dark-ground colours (bodyOnDark + accent), for surfaces that are
   *            indigo in every theme, like the brand panel.
   * knockout — all cells ivory, for a mark on a violet fill.
   */
  tone?: "auto" | "on-dark" | "knockout";
  title?: string;
  className?: string;
};

/** A cube mark, normalised to its own bounding box (several marks start at column 1 or 2).
 *  Brand rules enforced here: square cells, no gaps, the dome never cut — and below a 5px
 *  cell the gold square drops and the whole mark is drawn in the body colour. */
export function CubeMark({ mark = ZEKRA_MARK, size = 24, tone = "auto", title, className = "" }: CubeMarkProps) {
  const cols = mark.cells.map((c) => c[0]);
  const rows = mark.cells.map((c) => c[1]);
  const minC = Math.min(...cols);
  const minR = Math.min(...rows);
  const w = Math.max(...cols) - minC + 1;
  const h = Math.max(...rows) - minR + 1;
  const dropAccent = size / w <= 5;
  const isAccent = (c: number, r: number) =>
    !dropAccent && mark.accentCells.some(([ac, ar]) => ac === c && ar === r);

  const body =
    tone === "knockout" ? "#f0ebe1" : tone === "on-dark" ? (mark.bodyOnDark ?? mark.body) : "var(--grid-brand)";
  const accent =
    tone === "knockout" ? "#f0ebe1" : tone === "on-dark" ? mark.accent : "var(--grid-brand-accent)";

  return (
    <svg
      viewBox={`0 0 ${w * 10} ${h * 10}`}
      width={size}
      height={(size * h) / w}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`shrink-0 ${className}`}
    >
      {title && <title>{title}</title>}
      {mark.cells.map(([c, r]) => (
        <rect
          key={`${c}-${r}`}
          x={(c - minC) * 10}
          y={(r - minR) * 10}
          width={10}
          height={10}
          fill={isAccent(c, r) ? accent : body}
        />
      ))}
    </svg>
  );
}

/** The descriptor line of the lockup: a 16×2 violet rule, then "MEMORY FOR AGENTS" — or
 *  "ذاكرة للوكلاء" in Arabic, which is never set in mono or letter-spaced. */
export function BrandDescriptor({ className = "", muted = "text-muted-foreground" }: { className?: string; muted?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span aria-hidden className="block h-0.5 w-4 shrink-0 bg-violet" />
      <span className={`font-mono text-[9.5px] uppercase tracking-[0.28em] rtl:hidden ${muted}`}>Memory for agents</span>
      <span className={`hidden text-xs font-light rtl:inline ${muted}`}>ذاكرة للوكلاء</span>
    </span>
  );
}

/** Horizontal lockup: mark + name + descriptor. The name is Latin and never translated, so it
 *  stays LTR even inside an Arabic layout; the lockup itself follows the page direction. */
export function BrandLockup({
  size = 32,
  descriptor = true,
  className = "",
}: {
  size?: number;
  descriptor?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <CubeMark size={size} />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span dir="ltr" className="text-lg font-medium leading-none tracking-[-0.015em] text-foreground">
          Zekra
        </span>
        {descriptor && <BrandDescriptor />}
      </span>
    </span>
  );
}

/** The sidebar's brand header. Collapsed to the icon rail it shows the mark alone. */
export function SidebarBrand({ title = "Zekra" }: { title?: string }) {
  return (
    <Link to="/" title={title} className="flex items-center gap-2.5 px-2 py-1.5">
      <CubeMark size={26} />
      <span className="flex min-w-0 flex-col gap-1 group-data-[collapsible=icon]:hidden">
        <span dir="ltr" className="truncate text-[15px] font-medium leading-none tracking-[-0.015em] text-sidebar-foreground">
          Zekra
        </span>
        <BrandDescriptor />
      </span>
    </Link>
  );
}

/** The brand's memory square (the 9px cell from the recall panel), in the active colour —
 *  light violet on the dark ground, violet on ivory. Marks a brain, a live item, a hit. */
export function MemorySquare({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block size-2 shrink-0 bg-active ${className}`} />;
}
