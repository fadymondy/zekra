import type { Metadata } from "next"
import { notFound } from "next/navigation"

import "../site.css"
import { SiteAnalytics } from "@/components/site/site-analytics"
import {
  AI_SUMMARY,
  FACEBOOK_APP_ID,
  GA_ID,
  KEYWORDS,
  REPO,
  SITE_LOCALES,
  SITE_URL,
  TWITTER_HANDLE,
  YANDEX_VERIFICATION,
} from "@/lib/site/config"
import { landing } from "@/lib/site/landing"

/*
zekra.dev — the public landing + docs, reached only through proxy.ts's host rewrite
(zekra.dev/{locale}/… → /zsite/{locale}/…). Never linked as /zsite: every URL a visitor or
crawler sees is the public one.
*/

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const spec = landing(locale)
  return {
    metadataBase: new URL(SITE_URL),
    // The console root layout is noindex; the public site is what search engines should index.
    robots: { index: true, follow: true },
    applicationName: spec.localWordmark && locale === "ar" ? spec.localWordmark : spec.name,
    keywords: KEYWORDS,
    verification: { yandex: YANDEX_VERIFICATION },
    other: { "fb:app_id": FACEBOOK_APP_ID },
    icons: {
      icon: [
        { url: "/site/icon.svg", type: "image/svg+xml" },
        { url: "/site/icon.png", type: "image/png", sizes: "32x32" },
      ],
      apple: [{ url: "/site/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      type: "website",
      siteName: locale === "ar" && spec.localWordmark ? spec.localWordmark : spec.name,
      images: [{ url: "/site/og.png", width: 1200, height: 630, type: "image/png", alt: spec.name }],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER_HANDLE,
      creator: TWITTER_HANDLE,
      images: [{ url: "/site/og.png", width: 1200, height: 630, alt: spec.name }],
    },
  }
}

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { locale } = await params
  if (!(SITE_LOCALES as readonly string[]).includes(locale)) notFound()
  const spec = landing(locale)

  // The Site record's JSON-LD: SoftwareApplication + its Organization + the WebSite.
  const author = { "@type": "Person", "@id": "https://fadymondy.com/#person", name: "Fady Mondy", url: "https://fadymondy.com" }
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: spec.name,
        alternateName: "ذكرة",
        url: SITE_URL,
        description: spec.tagline,
        abstract: AI_SUMMARY,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web, macOS, Linux, Windows",
        inLanguage: locale,
        sameAs: [`https://github.com/${REPO}`, "https://x.com/fadymondy"],
        author,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: spec.name,
        url: SITE_URL,
        logo: `${SITE_URL}/site/apple-icon.png`,
        sameAs: ["https://x.com/fadymondy"],
        founder: author,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: spec.name,
        inLanguage: [...SITE_LOCALES],
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  }

  return (
    <div className="zsite">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- JSON.stringify output only
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {children}
      <SiteAnalytics gaId={GA_ID} locale={locale} />
    </div>
  )
}
