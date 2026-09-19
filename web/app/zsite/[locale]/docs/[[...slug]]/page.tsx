import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { DocsReader } from "@/components/site/docs-reader"
import { loadDocs, summarise } from "@/lib/site/docs"
import { landing } from "@/lib/site/landing"
import { sitePageMeta } from "@/lib/site/seo"

type Params = Promise<{ locale: string; slug?: string[] }>

function find(slug?: string[]) {
  const bundle = loadDocs()
  const wanted = (slug ?? []).map(decodeURIComponent).join("/")
  return { bundle, index: bundle.pages.findIndex((p) => p.slug === wanted) }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params
  const { bundle, index } = find(slug)
  const page = bundle.pages[index]
  if (!page) return {}
  const path = `/docs${page.slug ? `/${page.slug}` : ""}`
  const description = page.description || summarise(page.content) || `${page.title} — Zekra documentation.`
  const title = `${page.title} — ${landing(locale).name}`
  return sitePageMeta({ locale, path, title, description, type: "article" })
}

export default async function SiteDocPage({ params }: { params: Params }) {
  const { locale, slug } = await params
  const { bundle, index } = find(slug)
  if (index < 0) notFound()
  return <DocsReader spec={landing(locale)} locale={locale} bundle={bundle} index={index} />
}
