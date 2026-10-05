"use client"

// The brain the user last worked in, so the console reopens on it (sign-in, the brand link and
// the switcher outside a brain all land there). Per device, in localStorage, mirrored to a cookie
// so the proxy can send "/" straight to it.
const KEY = "zekra.lastBrain"
export const LAST_BRAIN_COOKIE = "zekra_last_brain"

export function getLastBrain(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastBrain(namespace: string) {
  try {
    window.localStorage.setItem(KEY, namespace)
    document.cookie = `${LAST_BRAIN_COOKIE}=${encodeURIComponent(namespace)}; path=/; max-age=31536000; samesite=lax`
  } catch {
    // storage blocked: the console just opens on the brains list
  }
}

/** Where a signed-in user lands: their last brain, else the brains list. */
export function homeHref(locale: string): string {
  const ns = getLastBrain()
  return ns ? `/${locale}/b/${encodeURIComponent(ns)}` : `/${locale}/brains`
}
