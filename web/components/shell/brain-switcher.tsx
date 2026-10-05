"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { LayoutGridIcon } from "lucide-react"
import { DropdownMenuItem, WorkspaceSwitcher } from "@fadymondy/nasaq/web"

import { BrainAvatar, brainName } from "@/components/brains/brain-cells"
import { getLastBrain, setLastBrain } from "@/lib/last-brain"
import { useTranslations } from "@/lib/i18n"
import { useBrains } from "@/lib/queries"

/**
 * The sidebar's tenant menu, for brains (Nasaq's WorkspaceSwitcher). Inside a brain, switching keeps
 * the section (notes, sources…); outside one it shows the last used brain and opens the picked one.
 * The brain in scope is remembered so the console reopens on it.
 */
export function BrainSwitcher({ namespace }: { namespace?: string }) {
  const { t, locale, formatNumber } = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const brains = useBrains()

  useEffect(() => {
    if (namespace) setLastBrain(namespace)
  }, [namespace])

  const list = brains.data ?? []
  if (!list.length) return null
  const last = getLastBrain()
  const value = namespace ?? (last && list.some((b) => b.namespace === last) ? last : list[0].namespace)

  function open(ns: string) {
    const prefix = namespace ? `/${locale}/b/${encodeURIComponent(namespace)}` : null
    const rest = prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ""
    router.push(`/${locale}/b/${encodeURIComponent(ns)}${rest}`)
  }

  return (
    <WorkspaceSwitcher
      workspaces={list.map((b) => ({
        id: b.namespace,
        name: brainName(b),
        description: t("shell.memoryCount", { count: formatNumber(b.memories) }),
        logo: <BrainAvatar namespace={b.namespace} profile={b} size={20} />,
      }))}
      value={value}
      onValueChange={open}
      labels={{ heading: t("shell.brains") }}
    >
      <DropdownMenuItem onClick={() => router.push(`/${locale}/brains`)}>
        <LayoutGridIcon />
        {t("shell.allBrains")}
      </DropdownMenuItem>
    </WorkspaceSwitcher>
  )
}
