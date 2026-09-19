"use client"

import { useDocumentTitle } from "@/lib/title"
import type { DeckContent, PageContent, PublicPresentation, ReportContent } from "@/lib/presentations/types"
import { useTranslations } from "@/lib/i18n"
import { DeckViewer } from "./deck-viewer"
import { PagePreview } from "./page-preview"
import { ReportView } from "./report-view"

/*
The body of a shared document, by kind. Client because the deck viewer and
charts are; the page is still server-rendered on first load.
*/
export function SharedView({ doc, who, token }: { doc: PublicPresentation; who: string; token?: string }) {
  const { t } = useTranslations()
  useDocumentTitle(doc.title)
  const dir = doc.locale === "ar" ? "rtl" : "ltr"
  switch (doc.kind) {
    case "deck":
      return (
        <DeckViewer
          content={doc.content as unknown as DeckContent}
          embeds={doc.embeds}
          dir={dir}
          // The deck's own link opens its embedded pages (FM-341 polish).
          embedHref={token ? (id) => `/${doc.locale}/p/${token}/embed/${encodeURIComponent(id)}` : undefined}
        />
      )
    case "report":
      return (
        <ReportView
          content={doc.content as unknown as ReportContent}
          locale={doc.locale}
          dir={dir}
          preparedFor={who ? t("presentations.shared.preparedFor", { who }) : undefined}
          labels={{ summary: t("presentations.export.summary"), contents: t("presentations.report.contents") }}
        />
      )
    case "page":
      return <PagePreview content={doc.content as unknown as PageContent} style={doc.style} dir={dir} />
  }
}
