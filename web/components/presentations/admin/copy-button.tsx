"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button, toast } from "@fadymondy/nasaq/web"

import { useTranslations } from "@/lib/i18n"

/** A button that copies `text` (a share link) and confirms with a toast; children add a visible label. */
export function CopyButton({
  text,
  variant = "secondary",
  size = "icon",
  children,
  ...props
}: { text: string } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const { t } = useTranslations()
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      toast.success(t("common.copied"))
      setTimeout(() => setDone(false), 1600)
    } catch {
      toast.error(t("common.copyFailed"))
    }
  }
  return (
    <Button type="button" variant={variant} size={size} onClick={copy} {...props}>
      {done ? <CheckIcon /> : <CopyIcon />}
      {children}
    </Button>
  )
}
