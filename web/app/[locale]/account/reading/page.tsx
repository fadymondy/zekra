"use client"

import { NoteSettingsPanel } from "@/components/notes/note-settings-panel"
import { SectionHeader } from "@/components/page"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

/*
Reading and editing preferences for notes (MH-213, MH-214): typography, editor
behaviour and the reading theme.

Lives under /account rather than per-brain because the settings are the
reader's, not the brain's — the same person wants the same font size in every
brain they open.
*/
export default function ReadingSettingsPage() {
  const { t } = useTranslations()
  useDocumentTitle(t("account.reading.title"))
  return (
    <div className="pb-10">
      <SectionHeader
        micro={t("account.micro")}
        title={t("account.reading.title")}
        description={t("account.reading.hint")}
      />
      <NoteSettingsPanel />
    </div>
  )
}
