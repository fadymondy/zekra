"use client"

import { usePathname, useRouter } from "next/navigation"
import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BrainAvatar, brainName } from "@/components/brains/brain-cells"
import { useTranslations } from "@/lib/i18n"
import { useBrains } from "@/lib/queries"

/** Managy's workspace switcher, for brains. Switching keeps the section (chat, sources…). */
export function BrainSwitcher({ namespace }: { namespace: string }) {
  const { t, locale, formatNumber } = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const brains = useBrains()
  const current = brains.data?.find((b) => b.namespace === namespace)

  function hrefFor(ns: string) {
    const prefix = `/${locale}/b/${encodeURIComponent(namespace)}`
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ""
    return `/${locale}/b/${encodeURIComponent(ns)}${rest}`
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-9 max-w-[9rem] justify-between gap-2 px-2.5 sm:max-w-[16rem]"
            aria-label={t("shell.switchBrain")}
          />
        }
      >
        <BrainAvatar namespace={namespace} profile={current} size={24} />
        <span dir="auto" className="hidden truncate text-sm font-medium sm:inline">
          {current ? brainName(current) : namespace}
        </span>
        <ChevronsUpDownIcon className="text-grid-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-64 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("shell.brains")}</DropdownMenuLabel>
          {(brains.data ?? []).map((b) => (
            <DropdownMenuItem key={b.namespace} onClick={() => router.push(hrefFor(b.namespace))}>
              <BrainAvatar namespace={b.namespace} profile={b} size={20} />
              <span dir="auto" className="min-w-0 flex-1 truncate">
                {brainName(b)}
              </span>
              <span className="text-xs text-grid-muted">{formatNumber(b.memories)}</span>
              {b.namespace === namespace ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(`/${locale}/brains`)}>
          <ArrowLeftIcon className="rtl:-scale-x-100" />
          {t("shell.allBrains")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
