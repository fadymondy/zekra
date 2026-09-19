// Page building blocks on the grid (fadymondy.com's design system), shared by every console
// screen so they read as one surface: typographic headings, hairline panels, hairline stat
// cells and the hatched separator band. No card islands, no shadows, square corners.
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Copy, Trash2, X } from "lucide-react";
import { Button } from "@togo-framework/ui";

/** A console page, laid out as Managy's: full-bleed, no outer padding — sections run edge to
 *  edge between the sidebar hairline and the viewport, split by their own hairlines. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 flex-col pb-10 ${className}`}>{children}</div>;
}

/** Page header (Managy's SectionHeader): micro-label eyebrow, title, body copy, trailing actions. */
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-6">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="grid-micro">{eyebrow}</p>}
        <h1 className="grid-title text-2xl">{title}</h1>
        {description && <p className="grid-body max-w-2xl text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A plain section title between full-bleed blocks (Managy's "Recent activity" heading). */
export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-3">
      <h2 className="text-base font-medium text-grid-fg">{children}</h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Horizontal padding for content that sits directly on the page (forms, toolbars, text). */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 ${className}`}>{children}</div>;
}

/** A full-bleed section: hairlines above and below (overlapping a neighbour's by -1px), with an
 *  optional header row (micro-label + meta + actions). No side borders, no card island. */
export function Panel({
  label,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  label?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`-mb-px flex flex-col border-y border-line bg-background ${className}`}>
      {(label || meta || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
          <span className="grid-micro">{label}</span>
          <span className="flex items-center gap-3">
            {meta && <span className="num text-[11px] text-grid-muted">{meta}</span>}
            {actions}
          </span>
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Managy's "In development" band: a hatched strip framing a card with the message. */
export function HatchBand({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`-mb-px border-y border-line p-3 hatch-band ${className}`}>
      <div className="border border-line bg-grid-card px-5 py-4">{children}</div>
    </div>
  );
}

// ── Tones ───────────────────────────────────────────────────────────────────
// State colour is reserved for state (ok / warn / danger / info) and always ships with a
// label; `active` is the brand's light-violet selection colour. Class names are literal so
// Tailwind sees every one.
export type Tone = "ok" | "warn" | "danger" | "info" | "active" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-tone-ok",
  warn: "text-tone-warn",
  danger: "text-tone-danger",
  info: "text-tone-info",
  active: "text-active",
  muted: "text-muted-foreground",
};
const TONE_FILL: Record<Tone, string> = {
  ok: "bg-tone-ok",
  warn: "bg-tone-warn",
  danger: "bg-tone-danger",
  info: "bg-tone-info",
  active: "bg-active",
  muted: "bg-muted-foreground",
};
const TONE_RULE: Record<Tone, string> = {
  ok: "border-s-tone-ok",
  warn: "border-s-tone-warn",
  danger: "border-s-tone-danger",
  info: "border-s-tone-info",
  active: "border-s-active",
  muted: "border-s-border",
};

/** Operation outcomes and source/gap states → tone. Unknown values stay muted. */
const STATE_TONE: Record<string, Tone> = {
  hit: "ok", add: "ok", ok: "ok", indexed: "ok",
  empty: "warn", syncing: "warn", open: "warn",
  error: "danger", invalidate: "danger",
  running: "info",
  update: "active",
};
export const toneFor = (state: string): Tone => STATE_TONE[state] ?? "muted";

/** The small tone square — the brand's memory square, coloured by state. */
export function ToneSquare({ tone }: { tone: Tone }) {
  return <span aria-hidden className={`size-1.5 shrink-0 ${TONE_FILL[tone]}`} />;
}

/** A state tag: a hairline chip with a tone square. The label always carries the meaning. */
export function ToneTag({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`grid-chip num shrink-0 ${className}`}>
      <ToneSquare tone={tone} />
      <span className={TONE_TEXT[tone]}>{children}</span>
    </span>
  );
}

/** An inline caveat: a hairline box with the tone as a rule on the inline-start edge. */
export function Notice({
  tone = "warn",
  icon,
  children,
  className = "",
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`flex items-start gap-2 border border-s-2 border-border ${TONE_RULE[tone]} bg-background px-3 py-2 text-xs text-card-foreground ${className}`}
    >
      {icon && <span className={`mt-px shrink-0 ${TONE_TEXT[tone]}`}>{icon}</span>}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────
export type Stat = {
  label: string;
  value: ReactNode;
  /** Colours the value with the text-safe tone; muted greys it out. */
  tone?: Tone;
  /** Optional router target — the cell becomes a link. */
  to?: string;
  params?: Record<string, string>;
};

/** The stat strip (Managy's overview details): full-bleed cells on the page ground, split by
 *  hairlines, a micro label over the value. Callers set the column count. */
export function StatCells({ stats, className = "" }: { stats: Stat[]; className?: string }) {
  return (
    <div className="-mb-px overflow-hidden">
      <dl className={`grid-cells grid-cells-flush-x text-sm ${className}`}>
        {stats.map((s) => {
          const body = (
            <>
              <dt className="grid-micro mb-1">{s.label}</dt>
              <dd className={`num text-xl font-medium ${s.tone ? TONE_TEXT[s.tone] : "text-grid-fg"}`}>{s.value}</dd>
            </>
          );
          return s.to ? (
            <Link key={s.label} to={s.to} params={s.params} className="block px-6 py-4 transition-colors hover:bg-grid-soft">
              {body}
            </Link>
          ) : (
            <div key={s.label} className="px-6 py-4">{body}</div>
          );
        })}
      </dl>
    </div>
  );
}

/** The hatched band between sections, contained (app shells have a sidebar, so the grid's
 *  full-bleed separator would run through the navigation). */
export function Hatch({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`grid-separator-contained grid-hatch ${className}`} />;
}

// ── Panel bodies ────────────────────────────────────────────────────────────

/** The brand's recall squares — three cells lighting in turn (colour-only motion). */
export function RecallSquares({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex items-center gap-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="cb-recall-square size-2" style={{ animationDelay: `${i * 0.22}s` }} />
      ))}
    </span>
  );
}

/** Loading line for a panel body. */
export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-10 text-sm text-muted-foreground">
      <RecallSquares />
      {label}
    </div>
  );
}

/** Empty panel body: three memory squares with one lit, a title, a hint and an optional action. */
export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span aria-hidden className="flex gap-1">
        <span className="size-2 bg-muted" />
        <span className="size-2 bg-active" />
        <span className="size-2 bg-muted" />
      </span>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {children && <p className="max-w-[52ch] text-sm font-light leading-relaxed text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

// ── Small controls ──────────────────────────────────────────────────────────

/** A read-only code value: LTR, mono, hairline. Truncates unless `wrap`. */
export function CodeValue({ children, wrap = false, className = "" }: { children: ReactNode; wrap?: boolean; className?: string }) {
  return (
    <code
      dir="ltr"
      className={`min-w-0 border border-border bg-background px-2 py-1 font-mono text-xs text-foreground ${wrap ? "break-all" : "truncate"} ${className}`}
    >
      {children}
    </code>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 shrink-0 gap-1 px-2 text-xs"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-tone-ok" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </Button>
  );
}

/** Two-step destructive action: the trigger arms it, Confirm runs it. An icon trigger unless
 *  `label` is given. */
export function ConfirmDelete({
  title,
  onConfirm,
  pending,
  label,
}: {
  title: string;
  onConfirm: () => void;
  pending: boolean;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (armed) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button type="button" variant="destructive" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onConfirm} disabled={pending}>
          <Trash2 className="h-3.5 w-3.5" /> {pending ? "Working…" : "Confirm"}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Cancel" onClick={() => setArmed(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </span>
    );
  }
  return label ? (
    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs text-tone-danger" title={title} onClick={() => setArmed(true)}>
      <Trash2 className="h-3.5 w-3.5" /> {label}
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-tone-danger"
      title={title}
      aria-label={title}
      onClick={() => setArmed(true)}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

/** A joined hairline segmented control; the pressed segment takes the action colour. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-border bg-card">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 px-3 text-xs transition-colors ${i ? "border-s border-border" : ""} ${
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A square mono monogram for an identity (agent, brain). Text carries identity, never a hue. */
export function Monogram({ id, className = "" }: { id: string; className?: string }) {
  const ch = id.replace(/[^\p{L}\p{N}]/gu, "").charAt(0) || "?";
  return (
    <span
      aria-hidden
      className={`num inline-flex size-5 shrink-0 items-center justify-center bg-muted text-[10px] font-medium uppercase text-foreground ${className}`}
    >
      {ch}
    </span>
  );
}
