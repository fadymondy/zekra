import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button, Checkbox } from "@togo-framework/ui";

// Read / write grant rows, shared by the brain workspace (agents for one brain) and the admin
// tokens screen (brains for one agent). One column grid so the checkboxes line up.
const COLS = "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_2rem] items-center gap-x-2";

export function GrantHeader({ subject }: { subject: string }) {
  return (
    <div className={`${COLS} border-b border-border px-4 py-2`}>
      <span className="micro text-muted-foreground">{subject}</span>
      <span className="micro text-center text-muted-foreground">Read</span>
      <span className="micro text-center text-muted-foreground">Write</span>
      <span />
    </div>
  );
}

/** One grant. Turning write on also turns read on — a writer that cannot recall is never useful. */
export function GrantRow({
  label,
  name,
  extra,
  canRead,
  canWrite,
  disabled,
  onChange,
  onRevoke,
  revoking,
}: {
  label: string;
  name: ReactNode;
  extra?: ReactNode;
  canRead: boolean;
  canWrite: boolean;
  disabled?: boolean;
  onChange: (next: { canRead: boolean; canWrite: boolean }) => void;
  onRevoke?: () => void;
  revoking?: boolean;
}) {
  return (
    <div className={`${COLS} px-4 py-2.5 text-sm`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {name}
        {extra}
      </div>
      <span className="flex justify-center">
        <Checkbox
          aria-label={`${label}: read`}
          checked={canRead}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ canRead: v === true, canWrite })}
        />
      </span>
      <span className="flex justify-center">
        <Checkbox
          aria-label={`${label}: write`}
          checked={canWrite}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ canRead: canRead || v === true, canWrite: v === true })}
        />
      </span>
      <span className="flex justify-center">
        {onRevoke && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-tone-danger"
            title="Revoke grant"
            aria-label={`Revoke ${label}`}
            onClick={onRevoke}
            disabled={revoking}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
    </div>
  );
}
