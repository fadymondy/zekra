"use client"

import { useState } from "react"
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ColorPicker } from "@/components/brains/color-picker"
import { ApiError, brainApi } from "@/lib/api"
import { profileApi } from "@/lib/brain-profile"
import { slugify } from "@/lib/brains"
import { useTranslations } from "@/lib/i18n"

const isBrainKey = (key: unknown) => {
  const k = Array.isArray(key) ? key[0] : key
  return typeof k === "string" && k.startsWith("/api/brain/")
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="border border-grid-danger/30 bg-grid-danger/10 px-3 py-2 text-xs text-grid-danger">
      {message}
    </p>
  )
}

/** A brain is a namespace: creating one retains a first marker memory so it exists and is
 *  connectable (exactly what the legacy console did). */
export function NewBrainDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (ns: string) => void }) {
  const { t } = useTranslations()
  const { mutate } = useSWRConfig()
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [color, setColor] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const slug = slugify(name)

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setName("")
      setDesc("")
      setColor("")
      setError(null)
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) return
    setBusy(true)
    setError(null)
    const displayName = name.trim()
    const profile = {
      ...(displayName && displayName !== slug ? { displayName } : {}),
      ...(color ? { color } : {}),
      ...(desc.trim() ? { description: desc.trim() } : {}),
    }
    try {
      // Claim the brain (owner = me) with its profile; the local console without a session
      // cannot claim, so it falls back to materializing the brain and patching the profile.
      let claimed = true
      try {
        await profileApi.createBrain({ namespace: slug, ...profile })
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 403)) throw err
        claimed = false
      }
      await brainApi.retain({
        namespace: slug,
        content: `Brain "${slug}" created from the console.${desc.trim() ? " " + desc.trim() : ""}`,
        sourceKind: "system",
        sourceRef: "console/new-brain",
      })
      if (!claimed && Object.keys(profile).length) await profileApi.update(slug, profile).catch(() => undefined)
      void mutate(isBrainKey)
      toast.success(t("brains.new.created", { brain: slug }))
      close(false)
      onCreated?.(slug)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("brains.new.title")}</DialogTitle>
            <DialogDescription>{t("brains.new.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="brain-name">{t("brains.new.name")}</Label>
            <Input id="brain-name" dir="auto" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("brains.new.namePlaceholder")} />
            {name && slug !== name.trim().toLowerCase() ? (
              <p className="text-xs text-grid-muted">
                {t("brains.new.namespace")}{" "}
                <code dir="ltr" className="font-mono">
                  {slug || "—"}
                </code>
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="brain-desc">
              {t("brains.new.descriptionLabel")} <span className="text-grid-muted">({t("common.optional")})</span>
            </Label>
            <Textarea
              id="brain-desc"
              rows={2}
              maxLength={2000}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t("brains.new.descriptionPlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              {t("brainSettings.general.color")} <span className="text-grid-muted">({t("common.optional")})</span>
            </Label>
            <ColorPicker value={color} onChange={setColor} custom={false} idPrefix="new-brain-color" />
          </div>
          <ErrorLine message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!slug || busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              {t("brains.new.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Deleting a brain removes every memory in it; the user types the namespace to confirm. */
export function DeleteBrainDialog({ namespace, onClose }: { namespace: string | null; onClose: () => void }) {
  const { t, formatNumber } = useTranslations()
  const { mutate } = useSWRConfig()
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const match = !!namespace && typed === namespace

  function close() {
    setTyped("")
    setError(null)
    onClose()
  }

  async function del(e: React.FormEvent) {
    e.preventDefault()
    if (!namespace || !match) return
    setBusy(true)
    setError(null)
    try {
      const res = await brainApi.deleteBrain({ namespace, confirm: namespace })
      void mutate(isBrainKey)
      toast.success(t("brains.delete.done", { brain: namespace, count: formatNumber(res?.deleted ?? 0) }))
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!namespace} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={del} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-grid-danger">{t("brains.delete.title")}</DialogTitle>
            <DialogDescription>{t("brains.delete.description", { brain: "⁨" + (namespace ?? "") + "⁩" })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="brain-confirm" className="font-normal text-grid-muted">
              {t("brains.delete.typeToConfirm", { brain: "⁨" + (namespace ?? "") + "⁩" })}
            </Label>
            <Input id="brain-confirm" dir="ltr" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={namespace ?? ""} />
          </div>
          <ErrorLine message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!match || busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              {t("brains.delete.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
