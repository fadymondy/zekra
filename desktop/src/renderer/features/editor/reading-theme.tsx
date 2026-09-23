import { useEffect } from "react";

import { useNoteSettings } from "@/components/notes/note-settings-panel";
import { NoteThemeStyle } from "@/components/notes/theme-picker";

import { syncWindowChrome } from "../../lib/platform";

/*
Applies the reading theme (Settings ▸ Reading, web lib/notes/note-settings.ts
store) to the document — the web mounts the same effect app-wide
(web/components/shell/app-shell.tsx AppThemeEffect). Mounted by the Brains
home and the notes workspace so the editor and preview always wear it; it is
idempotent, so an app-level mount elsewhere does not conflict. Typography
(font, size, width, wrap, line numbers) is read by the editor and preview
components themselves through useNoteSettings.
*/
export function ReadingTheme() {
  const { settings } = useNoteSettings();
  // Windows' native caption buttons follow the repainted title bar.
  useEffect(() => syncWindowChrome(), [settings.theme]);
  return <NoteThemeStyle id={settings.theme} />;
}
