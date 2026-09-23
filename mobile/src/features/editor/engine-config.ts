import { useMemo } from "react";

import { useI18n } from "@/lib/i18n";
import { useReadingSettings } from "@/lib/reading-settings";
import { metrics, useTheme } from "@/theme";

import type { EngineDir, EngineStrings, EngineTheme, Typography } from "./bridge-core";

/**
 * What every engine page (note editor, export host) needs from app state:
 * the theme, typography, direction and UI strings. Memoised so a page is only
 * told about a change when there is one.
 */
export function useEngineConfig(): { theme: EngineTheme; typography: Typography; dir: EngineDir; strings: EngineStrings } {
  const { palette, scheme } = useTheme();
  const reading = useReadingSettings();
  const { t, isRtl } = useI18n();

  const theme = useMemo<EngineTheme>(
    () => ({
      id: reading.theme,
      scheme,
      colors: {
        bg: palette.bg,
        card: palette.card,
        soft: palette.soft,
        line: palette.line,
        ink: palette.ink,
        body: palette.body,
        muted: palette.muted,
        action: palette.action,
        gold: palette.gold,
        danger: palette.danger,
      },
    }),
    [reading.theme, scheme, palette],
  );

  const typography = useMemo<Typography>(
    () => ({
      fontFamily: reading.fontFamily,
      fontSize: reading.fontSize,
      maxWidth: reading.maxWidth,
      wordWrap: reading.wordWrap,
      lineNumbers: reading.lineNumbers,
      // Text starts where the screen's rows do, clear of the rails.
      padX: metrics.padX,
    }),
    [reading.fontFamily, reading.fontSize, reading.maxWidth, reading.wordWrap, reading.lineNumbers],
  );

  const strings = useMemo<EngineStrings>(
    () => ({
      placeholder: t("note.writePlaceholder"),
      lossyTitle: t("editor.lossyTitle"),
      lossyBody: t("editor.lossyBody"),
      editSource: t("editor.editSource"),
      filter: t("editor.filter"),
      rows: t("editor.rows"),
      copy: t("editor.copy"),
    }),
    [t],
  );

  return { theme, typography, dir: isRtl ? "rtl" : "ltr", strings };
}
