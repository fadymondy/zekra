import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
Settings building blocks, in the macOS System Settings shape the web console's
settings pages also use: a titled group (micro label + optional description)
holding a bordered card of rows; each row a label/hint on the start side and
its control on the end side.
*/

export function SettingsHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-lg font-medium text-grid-fg">{title}</h1>
      {description ? <p className="text-sm text-grid-muted">{description}</p> : null}
    </header>
  );
}

export function Group({ title, description, children, tone }: {
  title?: string;
  description?: string;
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h2 className={cn("grid-micro", tone === "danger" ? "text-grid-danger" : "text-grid-muted")}>{title}</h2> : null}
      {description ? <p className="text-xs text-grid-muted">{description}</p> : null}
      <div
        className={cn(
          "flex flex-col divide-y divide-line overflow-hidden rounded-md border bg-grid-card",
          tone === "danger" ? "border-grid-danger/40" : "border-line",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Row({ label, hint, children, htmlFor, stack }: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  /** Put the control under the label (wide inputs). */
  stack?: boolean;
}) {
  return (
    <div className={cn("flex gap-4 px-4 py-3", stack ? "flex-col gap-2" : "items-center")}>
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm text-grid-fg">
            {label}
          </label>
        ) : (
          <div className="text-sm text-grid-fg">{label}</div>
        )}
        {hint ? <div className="mt-0.5 text-xs text-grid-muted">{hint}</div> : null}
      </div>
      {children !== undefined ? <div className={cn("flex items-center gap-2", stack ? "w-full" : "shrink-0")}>{children}</div> : null}
    </div>
  );
}

/** A choice between a few options (theme, language) — a compact segmented control. */
export function Segmented<V extends string>({ value, options, onChange, label }: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-grid-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] px-3 py-1 text-xs transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-grid-muted hover:text-grid-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
