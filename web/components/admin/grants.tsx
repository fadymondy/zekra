"use client"

import type { ReactNode } from "react"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useTranslations } from "@/lib/i18n"

// Read / write grant rows, shared by a brain's Permissions page (agents for one brain) and the
// admin tokens page (brains for one agent). One column grid so the checkboxes line up.
const COLS = "grid grid-cols-[minmax(0,1fr)_4rem_4rem_2.5rem] items-center gap-x-2"

export function GrantHeader({ subject }: { subject: string }) {
  const { t } = useTranslations()
  return (
    <div className={`${COLS} border-b border-line px-6 py-2`}>
      <span className="grid-micro">{subject}</span>
      <span className="grid-micro text-center">{t("permissions.read")}</span>
      <span className="grid-micro text-center">{t("permissions.write")}</span>
      <span />
    </div>
  )
}

/** One grant. Turning write on also turns read on: a writer that cannot recall is never useful. */
export function GrantRow({
  label,
  name,
  extra,
  canRead,
  canWrite,
  disabled,
  onChange,
  onRevoke,
}: {
  label: string
  name: ReactNode
  extra?: ReactNode
  canRead: boolean
  canWrite: boolean
  disabled?: boolean
  onChange: (next: { canRead: boolean; canWrite: boolean }) => void
  onRevoke?: () => void
}) {
  const { t } = useTranslations()
  return (
    <div className={`${COLS} px-6 py-3 text-sm`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {name}
        {extra}
      </div>
      <span className="flex justify-center">
        <Checkbox
          aria-label={t("permissions.readFor", { name: label })}
          checked={canRead}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ canRead: v === true, canWrite: v === true ? canWrite : false })}
        />
      </span>
      <span className="flex justify-center">
        <Checkbox
          aria-label={t("permissions.writeFor", { name: label })}
          checked={canWrite}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ canRead: canRead || v === true, canWrite: v === true })}
        />
      </span>
      <span className="flex justify-center">
        {onRevoke ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-grid-muted hover:text-grid-danger-text"
            title={t("permissions.revokeGrant")}
            aria-label={t("permissions.revokeFor", { name: label })}
            onClick={onRevoke}
            disabled={disabled}
          >
            <XIcon />
          </Button>
        ) : null}
      </span>
    </div>
  )
}
