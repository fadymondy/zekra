import type { ReactNode } from "react";
import { FileText, Globe, Presentation } from "lucide-react";

import { cn } from "@/lib/utils";
import { orderedLocales, statusTone, type Tone } from "@mobile/features/presentations/presentations-core";

import { useFormat } from "./format";

/** deck = Presentation, report = FileText, page = Globe. */
export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kind === "report" ? FileText : kind === "page" ? Globe : Presentation;
  return <Icon className={cn("size-4", className)} strokeWidth={1.6} />;
}

export function KindTile({ kind, size = 36 }: { kind: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md border border-line bg-grid-bg text-grid-body"
      style={{ width: size, height: size }}
    >
      <KindIcon kind={kind} />
    </span>
  );
}

const TONE: Record<Tone | "danger" | "gold", string> = {
  muted: "border-line text-grid-muted",
  ok: "border-grid-ok/50 text-grid-ok",
  warn: "border-grid-warn/50 text-grid-warn",
  danger: "border-grid-danger/50 text-grid-danger",
  gold: "border-grid-gold/60 text-grid-gold",
};

/** The grid's small uppercase chip. */
export function Chip({ children, tone = "muted", className }: { children: ReactNode; tone?: keyof typeof TONE; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[10px] font-medium tracking-wide uppercase", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const f = useFormat();
  return <Chip tone={statusTone(status)}>{f.status(status)}</Chip>;
}

/** "EN · AR" — the languages a document has. */
export function LocaleChips({ locales }: { locales: string[] | null | undefined }) {
  const f = useFormat();
  const list = orderedLocales(locales);
  if (!list.length) return null;
  return <Chip>{list.map((l) => f.short(l)).join(" · ")}</Chip>;
}

/** A section heading in the detail pane. */
export function Micro({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-2">
      <h3 className="grid-micro flex-1 text-grid-muted">{children}</h3>
      {end}
    </div>
  );
}

/** A segmented control (shadcn buttons in a hairline group). */
export function Segmented<T extends string>({ value, onChange, options, disabled, label }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit overflow-hidden rounded-md border border-line bg-grid-bg">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1 text-xs transition-colors disabled:opacity-50",
            i > 0 && "border-s border-line",
            value === o.value ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Gold-when-selected toggle chip (kind strip, expiry presets, styles). */
export function ToggleChip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
        on ? "border-grid-gold bg-grid-gold/10 text-grid-fg" : "border-line text-grid-muted hover:bg-grid-soft hover:text-grid-fg",
      )}
    >
      {children}
    </button>
  );
}

export function ErrorLines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div role="alert" className="flex flex-col gap-1">
      {lines.map((m, i) => (
        <p key={i} className="text-xs whitespace-pre-line text-grid-danger">
          {m}
        </p>
      ))}
    </div>
  );
}
