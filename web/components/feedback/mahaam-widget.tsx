"use client"

// Mahaam's official feedback widget (https://console.mahaam.app/embed/v1.js), the same dialog
// Mahaam ships to every product: type, priority, details, screenshot, element picker, console
// and network capture, "Powered by Mahaam". Reports land in the Zekra project on Mahaam.
// Its floating launcher is off (data-launcher="false"): the dialog opens only from the shell's
// "Report a problem" header button.
import Script from "next/script"

const MAHAAM_URL = process.env.NEXT_PUBLIC_MAHAAM_URL ?? "https://console.mahaam.app"
const FEEDBACK_KEY = process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY ?? ""

export const feedbackEnabled = FEEDBACK_KEY !== ""

type MahaamFeedbackApi = { open: () => void; show?: () => void }

/** Opens Mahaam's report dialog; false while the widget script is still loading. */
export function openFeedback(): boolean {
  const api = (window as unknown as { MahaamFeedback?: MahaamFeedbackApi }).MahaamFeedback
  if (!api) return false
  api.open()
  return true
}

export function MahaamWidget({ locale }: { locale: string }) {
  if (!feedbackEnabled) return null
  return (
    <Script
      id="mahaam-feedback"
      src={`${MAHAAM_URL}/embed/v1.js`}
      data-key={FEEDBACK_KEY}
      data-locale={locale === "ar" ? "ar" : "en"}
      data-launcher="false"
      strategy="afterInteractive"
    />
  )
}
