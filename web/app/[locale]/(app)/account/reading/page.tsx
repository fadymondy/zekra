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
      {/* The panel is shared with the Electron renderer, which has no i18n
          provider, so it takes its copy as a prop rather than calling
          useTranslations itself (same treatment as NoteTabs). */}
      <NoteSettingsPanel
        labels={{
          typography: t("account.reading.typography"),
          typographyHint: t("account.reading.typographyHint"),
          fontFamily: t("account.reading.fontFamily"),
          fontFamilyHint: t("account.reading.fontFamilyHint"),
          fontSize: t("account.reading.fontSize"),
          fontSizeHint: t("account.reading.fontSizeHint"),
          maxWidth: t("account.reading.maxWidth"),
          maxWidthHint: t("account.reading.maxWidthHint"),
          fullWidth: t("account.reading.fullWidth"),
          editor: t("account.reading.editor"),
          editorHint: t("account.reading.editorHint"),
          wordWrap: t("account.reading.wordWrap"),
          wordWrapHint: t("account.reading.wordWrapHint"),
          lineNumbers: t("account.reading.lineNumbers"),
          lineNumbersHint: t("account.reading.lineNumbersHint"),
          autoSave: t("account.reading.autoSave"),
          autoSaveHint: t("account.reading.autoSaveHint"),
          autoSaveOff: t("account.reading.autoSaveOff"),
          autoSaveBlur: t("account.reading.autoSaveBlur"),
          autoSaveInterval: t("account.reading.autoSaveInterval"),
          readingTheme: t("account.reading.theme"),
          readingThemeHint: t("account.reading.themeHint"),
          lightThemes: t("account.reading.lightThemes"),
          darkThemes: t("account.reading.darkThemes"),
          ownPalette: t("account.reading.ownPalette"),
        }}
      />
    </div>
  )
}
