import type { ReactNode } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/*
Settings building blocks — the desktop "grouped rows" shape (macOS System
Settings, the approved Sync & offline group): a small section title above a
rounded group; each row a title + secondary description on the start side and
its control on the end side — a native-looking switch (shadcn Switch), a
compact segmented control on theme tokens, a select or a button. Every
section of the Settings window is built from these (no web panels).
*/

/** A section's intro. The Settings window names the section in its title row
 *  and tabs (screens/settings-window.tsx), so the heading is for assistive
 *  tech only; the description shows as the section's lead line. */
export function SettingsHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="sr-only">{title}</h1>
      {description ? <p className="px-1 text-[13px] leading-snug text-muted-foreground">{description}</p> : null}
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
    <section className="flex flex-col gap-1.5">
      {title ? (
        <h2 className={cn("px-1 text-[13px] font-semibold", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>{title}</h2>
      ) : null}
      {description ? <p className="px-1 text-xs text-muted-foreground">{description}</p> : null}
      <div
        className={cn(
          "flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border bg-pane-raised",
          tone === "danger" ? "border-destructive/30" : "border-border/70",
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
    <div className={cn("flex min-h-11 gap-4 px-4 py-2.5", stack ? "flex-col gap-2" : "items-center")}>
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[14px] text-foreground">
            {label}
          </label>
        ) : (
          <div className="text-[14px] text-foreground">{label}</div>
        )}
        {hint ? <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{hint}</div> : null}
      </div>
      {children !== undefined ? <div className={cn("flex items-center gap-2", stack ? "w-full" : "shrink-0")}>{children}</div> : null}
    </div>
  );
}

/** A choice between a few options (theme, language) — a macOS segmented
 *  control, the shadcn ToggleGroup. */
export function Segmented<V extends string>({ value, options, onChange, label }: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v: unknown[]) => {
        const next = v[0] as V | undefined;
        if (next) onChange(next);
      }}
      spacing={0}
      aria-label={label}
      className="rounded-md bg-muted/70 p-0.5"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-6 rounded-[5px]! px-3 text-[13px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground data-[pressed]:bg-background data-[pressed]:text-foreground data-[pressed]:shadow-sm aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
