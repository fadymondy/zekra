"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"

/** An icon button that copies `text` (a share link) and confirms with a toast. */
export function CopyButton({
  text,
  variant = "outline",
  size = "icon",
  ...props
}: { text: string } & Omit<React.ComponentProps<typeof Button>, "onClick" | "children">) {
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
    </Button>
  )
}
