"use client"

// The brain the user last worked in, so the console reopens on it (sign-in, the brand link and
// the switcher outside a brain all land there). Per device, in localStorage.
const KEY = "zekra.lastBrain"

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
  } catch {
    // storage blocked: the console just opens on the brains list
  }
}

/** Where a signed-in user lands: Home, every brain's status. */
export function homeHref(locale: string): string {
  return `/${locale}/brains`
}
