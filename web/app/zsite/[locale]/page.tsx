import type { Metadata } from "next"

import { SiteLanding } from "@/components/site/site-landing"
import { sitePageMeta } from "@/lib/site/seo"
import { landing } from "@/lib/site/landing"

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const spec = landing(locale)
  return sitePageMeta({ locale, path: "", title: spec.metaTitle, description: spec.metaDescription ?? spec.tagline })
}

export default async function SiteHome({ params }: { params: Params }) {
  const { locale } = await params
  return <SiteLanding spec={landing(locale)} locale={locale} />
}
