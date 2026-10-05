"use client"

import { Badge, Button, Card, CardContent } from "@fadymondy/nasaq/web"

import { useCallback, useEffect, useState } from "react"
import { BrainIcon, Loader2Icon, QrCodeIcon } from "lucide-react"

import { statusVariant } from "@/components/media/kind-icon"
import { LiveCamera } from "@/components/media/live-camera"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { cameraPass, type Media } from "@/lib/media"
import { useDocumentTitle } from "@/lib/title"

type Session = { token: string; namespace: string; expiresAt: string }

// One open per page load: the code works once, and dev StrictMode runs effects twice.
let opening: Promise<Session> | null = null

function openSession(): Promise<Session> {
  return (opening ??= (async () => {
    const code = window.location.hash.slice(1)
    if (code) {
      // Drop the code from the address bar and history before anything else.
      window.history.replaceState(null, "", window.location.pathname)
      return cameraPass.redeem(code)
    }
    const token = cameraPass.stored()
    if (!token) throw new ApiError(401, "")
    const s = await cameraPass.session(token)
    return { token, namespace: s.namespace, expiresAt: s.expiresAt }
  })())
}

/*
/{locale}/cam — the phone side of "Use your phone". The desktop's QR code opens this page with a
one-time code in the #fragment; it is spent at once for a camera-only pass to one brain, kept in
this tab's sessionStorage (a reload keeps working, closing the tab forgets it). No sign-in: the
pass can read live and save frames to that brain, nothing else.
*/
export default function PhoneCameraPage() {
  const { t, formatDate } = useTranslations()
  useDocumentTitle(t("media.live"))
  const [session, setSession] = useState<Session | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<Media[]>([])

  useEffect(() => {
    let cancelled = false
    async function open() {
      try {
        const s = await openSession()
        if (!cancelled) setSession(s)
      } catch (err) {
        if (cancelled) return
        if (!(err instanceof ApiError) || err.status !== 410) cameraPass.forget()
        setProblem(err instanceof ApiError && err.status !== 0 ? (err.status === 410 ? t("media.phone.codeUsed") : t("media.phone.ended")) : t("common.networkError"))
      }
    }
    void open()
    return () => {
      cancelled = true
    }
  }, [t])

  // Poll the frames saved from this phone until they are read.
  useEffect(() => {
    if (!session || !saved.some((m) => m.status === "pending" || m.status === "processing")) return
    const id = window.setInterval(async () => {
      const next = await Promise.all(
        saved.map((m) => (m.status === "pending" || m.status === "processing" ? cameraPass.media(session.token, m.id).catch(() => m) : m)),
      )
      setSaved(next)
    }, 3_000)
    return () => window.clearInterval(id)
  }, [session, saved])

  const wsURL = useCallback(() => (session ? cameraPass.liveURL(session.token, session.namespace) : ""), [session])
  const save = useCallback(
    async (blob: Blob, name: string) => {
      if (!session) return
      const m = await cameraPass.upload(session.token, session.namespace, blob, name)
      setSaved((list) => [m, ...list.filter((x) => x.id !== m.id)].slice(0, 12))
    },
    [session],
  )

  if (problem)
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-nq-hover text-muted-foreground">
              <QrCodeIcon className="size-6" />
            </span>
            <p className="text-sm">{problem}</p>
            <p className="text-xs text-muted-foreground">{t("media.phone.scanAgain")}</p>
          </CardContent>
        </Card>
      </main>
    )

  if (!session)
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </main>
    )

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-3 sm:p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--nq-action)_14%,transparent)] text-nq-action">
          <BrainIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{session.namespace}</div>
          <div className="text-xs text-muted-foreground">{t("media.phone.until", { time: formatDate(session.expiresAt, { timeStyle: "short" }) })}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void cameraPass.end(session.token)
            cameraPass.forget()
            setProblem(t("media.phone.ended"))
          }}
        >
          {t("media.phone.leave")}
        </Button>
      </header>

      <LiveCamera wsURL={wsURL} onSave={save} autoStart />

      {saved.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-1">
            <div className="mb-1 text-sm font-medium">{t("media.phone.savedTitle")}</div>
            {saved.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate" dir="ltr">
                  {m.name}
                </span>
                <Badge variant={statusVariant(m.status)}>{t(`media.status.${m.status}`)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </main>
  )
}
