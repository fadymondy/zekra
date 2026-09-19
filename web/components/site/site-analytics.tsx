"use client"

import { useEffect, useState } from "react"
import Script from "next/script"

const KEY = "zekra-site-consent"

const COPY = {
  en: {
    title: "Cookies",
    body: "This site uses cookies for analytics, to see which pages are read and how visitors find them. No analytics cookies are set until you accept.",
    reject: "Reject all",
    accept: "Accept all",
  },
  ar: {
    title: "ملفات تعريف الارتباط",
    body: "يستخدم هذا الموقع ملفات تعريف الارتباط للتحليلات، لمعرفة الصفحات المقروءة وكيف يصل إليها الزوار. لا تُضبط أي ملفات تحليلات قبل موافقتك.",
    reject: "رفض الكل",
    accept: "قبول الكل",
  },
}

/*
Google Analytics behind a consent banner, as zekra.dev had it (fadymondy.com-v2 used c15t for
this). gtag.js is only requested after "Accept"; the choice is kept in localStorage. Without
NEXT_PUBLIC_GA_ID there is nothing to consent to, so nothing renders.
*/
export function SiteAnalytics({ gaId, locale }: { gaId: string; locale: string }) {
  const [consent, setConsent] = useState<"granted" | "denied" | null | undefined>(undefined)

  useEffect(() => {
    const saved = localStorage.getItem(KEY)
    // Reading persisted client state once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsent(saved === "granted" || saved === "denied" ? saved : null)
  }, [])

  if (!gaId) return null
  const t = locale === "ar" ? COPY.ar : COPY.en
  const choose = (value: "granted" | "denied") => {
    localStorage.setItem(KEY, value)
    setConsent(value)
  }

  return (
    <>
      {consent === "granted" ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(gaId)});`}
          </Script>
        </>
      ) : null}
      {consent === null ? (
        <div
          role="dialog"
          aria-label={t.title}
          className="fixed start-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-popover p-4 text-popover-foreground shadow-lg"
        >
          <p className="text-sm font-semibold text-foreground">{t.title}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t.body}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => choose("denied")}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40"
            >
              {t.reject}
            </button>
            <button
              type="button"
              onClick={() => choose("granted")}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-opacity hover:opacity-90"
            >
              {t.accept}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
