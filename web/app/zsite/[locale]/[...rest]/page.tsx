import { notFound } from "next/navigation"

// Anything else on zekra.dev is not a page of the site.
export default function SiteUnknown() {
  notFound()
}
