"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useTranslations } from "@/lib/i18n"

/*
The spotlight trigger, following fadymondy.com-v2's command-menu: the button
and the ⌘K shortcut stay in the page bundle so they are instant, while the
dialog (cmdk + the brain-search client) is fetched the first time someone opens
it and then kept mounted, so reopening is immediate and a typed query survives
a close. Hover/focus starts the fetch early.
*/
const SpotlightPanel = dynamic(() => import("./spotlight-panel").then((m) => m.SpotlightPanel), {
  ssr: false,
})

const preload = () => void import("./spotlight-panel")

export function Spotlight({ namespace }: { namespace?: string }) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  // Once opened, stays mounted.
  const [wanted, setWanted] = useState(false)

  const show = (next: boolean) => {
    if (next) setWanted(true)
    setOpen(next)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return
      // Leave find-in-page and the address bar alone.
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return
      e.preventDefault()
      setWanted(true)
      setOpen((v) => !v)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      <Button
        data-slot="spotlight-trigger"
        variant="ghost"
        size="sm"
        aria-label={t("spotlight.label")}
        className="gap-1.5 border-none px-1.5 text-grid-muted select-none"
        onClick={() => show(true)}
        onPointerEnter={preload}
        onFocus={preload}
      >
        <SearchIcon />
        <span className="font-sans text-sm/4 font-medium sm:hidden">{t("spotlight.label")}</span>
        <KbdGroup className="hidden gap-0.75 sm:flex">
          <Kbd className="w-5 min-w-auto">⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      {wanted ? <SpotlightPanel open={open} onOpenChange={show} namespace={namespace} /> : null}
    </>
  )
}
