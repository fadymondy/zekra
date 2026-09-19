import type { Metadata } from "next"

import { SITE_LOCALES, TWITTER_HANDLE } from "@/lib/site/config"
import { landing } from "@/lib/site/landing"

/** Canonical + hreflang for a locale-less public path ("" is the home page). */
export function siteAlternates(locale: string, path: string): Metadata["alternates"] {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(SITE_LOCALES.map((l) => [l, `/${l}${path}`])),
      "x-default": `/en${path}`,
    },
  }
}

/*
A page's full metadata. Built in one place because Next replaces a parent's openGraph and
twitter blocks wholesale: a page that set only its title there silently dropped og:image.
*/
export function sitePageMeta({
  locale,
  path,
  title,
  description,
  type = "website",
}: {
  locale: string
  path: string
  title: string
  description: string
  type?: "website" | "article"
}): Metadata {
  const spec = landing(locale)
  // The product's name in the page's language, share tags included.
  const brand = locale === "ar" && spec.localWordmark ? spec.localWordmark : spec.name
  const image = { url: "/site/og.png", width: 1200, height: 630, type: "image/png", alt: brand }
  return {
    title: { absolute: title },
    description,
    applicationName: brand,
    alternates: siteAlternates(locale, path),
    openGraph: {
      type,
      title,
      description,
      url: `/${locale}${path}`,
      siteName: brand,
      locale: locale === "ar" ? "ar_SA" : "en_US",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER_HANDLE,
      creator: TWITTER_HANDLE,
      title,
      description,
      images: [image],
    },
  }
}
