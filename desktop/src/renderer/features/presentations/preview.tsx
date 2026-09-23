import { Component, useEffect, useMemo, useState, type ReactNode } from "react";

import { DeckViewer } from "@/components/presentations/deck-viewer";
import { PagePreview } from "@/components/presentations/page-preview";
import { PresTheme } from "@/components/presentations/pres-theme";
import { ReportView } from "@/components/presentations/report-view";
import { I18nProvider as WebI18nProvider, trans } from "@/lib/i18n";
import type { DeckContent, PageContent, ReportContent } from "@/lib/presentations/types";
import { customerLine } from "@mobile/features/presentations/presentations-core";
import type { Detail, PLocale } from "@mobile/features/presentations/types";

import { useI18n } from "../../lib/i18n";
import { presentationsApi } from "./api";

/*
The presentation rendered natively with the WEB console's own viewers
(web/components/presentations: DeckViewer, ReportView, PagePreview) — the same
components the public /{locale}/p/{token} page and the owner's editor use, so
what shows here is what the customer sees. It renders the owner's copy
(GET /api/presentations/{id} content[locale]) exactly as the web editor's
preview does, so previewing needs no share link and never counts a view.

The web viewers read their chrome strings through the web's own i18n
context, so they are wrapped in it (in the app's UI language).
*/

type Embeds = Record<string, { style: string; content: PageContent }>;

function useEmbeds(token: string, doc: Detail, locale: PLocale): Embeds {
  const [embeds, setEmbeds] = useState<Embeds>({});
  const ids = useMemo(() => {
    if (doc.kind !== "deck") return [];
    const slides = ((doc.content?.[locale] as { slides?: { type?: string; document_id?: string }[] } | undefined)?.slides ?? []);
    return [...new Set(slides.filter((s) => s?.type === "embed" && s.document_id).map((s) => String(s.document_id)))];
  }, [doc, locale]);
  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      presentationsApi
        .get(token, id)
        .then((p) => {
          const c = (p.content?.[locale] ?? p.content?.[p.locale]) as unknown as PageContent | undefined;
          if (alive && c) setEmbeds((m) => ({ ...m, [id]: { style: p.style, content: c } }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [ids, token, locale]);
  return embeds;
}

export function PresentationPreview({ token, doc, locale, fill = false }: {
  token: string;
  doc: Detail;
  locale: PLocale;
  /** Fill the parent's height (the full-screen dialog) rather than size to content. */
  fill?: boolean;
}) {
  const { t, locale: uiLocale } = useI18n();
  const embeds = useEmbeds(token, doc, locale);
  const content = doc.content?.[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const who = customerLine(doc.customer);

  if (!content) {
    return <p className="px-4 py-10 text-center text-sm text-grid-muted">{t("desk.pres.previewEmpty")}</p>;
  }

  let body: ReactNode;
  switch (doc.kind) {
    case "deck":
      body = <DeckViewer content={content as unknown as DeckContent} embeds={embeds} dir={dir} fill={false} />;
      break;
    case "report":
      body = (
        <ReportView
          content={content as unknown as ReportContent}
          locale={locale}
          dir={dir}
          preparedFor={who ? trans("presentations.shared.preparedFor", uiLocale, { who }) : undefined}
          labels={{ summary: trans("presentations.export.summary", uiLocale), contents: trans("presentations.report.contents", uiLocale) }}
        />
      );
      break;
    default:
      body = <PagePreview content={content as unknown as PageContent} style={doc.style} dir={dir} still={!fill} />;
  }

  return (
    <PreviewBoundary fallback={<p className="px-4 py-10 text-center text-sm text-grid-danger">{t("presentations.preview.failed")}</p>}>
      <WebI18nProvider locale={uiLocale}>
        <PresTheme className={fill ? "min-h-full" : undefined}>
          <div lang={locale}>{body}</div>
        </PresTheme>
      </WebI18nProvider>
    </PreviewBoundary>
  );
}

/** Content that the viewers cannot render must not take the whole detail pane down. */
class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[zekra] presentation preview failed", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
