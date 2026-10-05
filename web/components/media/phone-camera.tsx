"use client"

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  QrCode,
  toast,
} from "@fadymondy/nasaq/web"

import { useEffect, useState } from "react"
import { CopyIcon, Loader2Icon, RefreshCwIcon, SmartphoneIcon } from "lucide-react"

import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { cameraLink, cameraPairingApi, useCameraPairing, type CameraPairing } from "@/lib/media"

/** "Use your phone": a one-time QR code that opens the phone straight into this brain's live
 * camera. The code lasts a few minutes and works once; the phone then holds a camera-only pass
 * to this brain that this dialog can end. */
export function PhoneCameraButton({ namespace }: { namespace: string }) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <SmartphoneIcon /> {t("media.phone.button")}
      </Button>
      {open ? <PhoneCameraDialog namespace={namespace} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function PhoneCameraDialog({ namespace, onClose }: { namespace: string; onClose: () => void }) {
  const { t, locale, formatDate } = useTranslations()
  const [created, setCreated] = useState<CameraPairing | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: live, mutate } = useCameraPairing(created?.id)
  const p = live ?? created
  const link = created?.code ? cameraLink(locale, created.code) : ""

  async function create() {
    setBusy(true)
    try {
      setCreated(await cameraPairingApi.create(namespace))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void create()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace])

  async function end() {
    if (!p) return
    try {
      await cameraPairingApi.end(p.id)
      void mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("media.phone.title")}</DialogTitle>
          <DialogDescription>{t("media.phone.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {!p || busy ? (
            <div className="flex size-56 items-center justify-center rounded-2xl bg-nq-hover">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : p.status === "waiting" ? (
            <>
              <div className="rounded-2xl bg-white p-3">
                <QrCode value={link} size={224} ecc="M" moduleStyle="rounded" eyeStyle="rounded" fg="#0B1429" bg="#FFFFFF" label={t("media.phone.title")} />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                {t("media.phone.scan", { time: formatDate(p.expiresAt, { timeStyle: "short" }) })}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success(t("media.copied")))}>
                <CopyIcon /> {t("media.phone.copyLink")}
              </Button>
            </>
          ) : p.status === "connected" ? (
            <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-nq-hover px-4 py-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--nq-success)_16%,transparent)] text-nq-success">
                <SmartphoneIcon className="size-6" />
              </span>
              <Badge variant="success">{t("media.phone.connected")}</Badge>
              <p className="text-sm text-muted-foreground">{t("media.phone.connectedBody", { time: formatDate(p.expiresAt, { timeStyle: "short" }) })}</p>
            </div>
          ) : (
            <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-nq-hover px-4 py-6 text-center">
              <Badge variant="outline">{t(`media.phone.status.${p.status}`)}</Badge>
              <p className="text-sm text-muted-foreground">{t("media.phone.expiredBody")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {p && p.status === "connected" ? (
            <Button variant="danger" onClick={end}>
              {t("media.phone.end")}
            </Button>
          ) : p && p.status !== "waiting" ? (
            <Button variant="secondary" onClick={() => void create()}>
              <RefreshCwIcon /> {t("media.phone.newCode")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {t("media.phone.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
