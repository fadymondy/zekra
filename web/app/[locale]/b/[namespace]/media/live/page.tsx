"use client"

import { Button } from "@fadymondy/nasaq/web"

import { useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { LiveCamera } from "@/components/media/live-camera"
import { PhoneCameraButton } from "@/components/media/phone-camera"
import { PageBody, SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { liveMediaURL, uploadMedia } from "@/lib/media"
import { useDocumentTitle } from "@/lib/title"

/** Live camera mode on this device, or "Use your phone" to scan with the phone's camera. */
export default function LiveMediaPage() {
  const { t } = useTranslations()
  const params = useParams<{ namespace: string }>()
  const namespace = decodeURIComponent(params.namespace)
  useDocumentTitle(`${t("media.live")} · ${namespace}`)

  const wsURL = useCallback(() => liveMediaURL(namespace), [namespace])
  const save = useCallback(async (blob: Blob, name: string) => void (await uploadMedia(namespace, blob, name)), [namespace])

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" nativeButton={false} render={<Link href={`/b/${encodeURIComponent(namespace)}/media`} />}>
        <ArrowLeftIcon className="rtl:rotate-180" /> {t("media.title")}
      </Button>
      <PhoneCameraButton namespace={namespace} />
    </div>
  )

  return (
    <div>
      <SectionHeader micro={t("media.micro")} title={t("media.live")} description={t("media.liveDescription")} action={actions} />
      <PageBody>
        <LiveCamera wsURL={wsURL} onSave={save} />
      </PageBody>
    </div>
  )
}
