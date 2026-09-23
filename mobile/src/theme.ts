import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useColorScheme } from "react-native";

import { paletteFromTheme } from "@/features/editor/reading-core";
import { hydrateReading, readingTheme, useReadingSettings } from "@/lib/reading-settings";
import { getStored, setStored } from "@/lib/storage";

// Design system ported from fadymondy.com-v2/mobile/src/theme/tokens.ts (the
// house mobile design: rails, hatch ground, rows, 27/600 headers). The palette
// keeps ZEKRA's own brand colors — violet action + gold accent from
// web/app/styles/grid-tokens.css — rather than that app's orange.

const light = {
  bg: "#f0ebe1",
  card: "#f7f4ea",
  soft: "#ddd5c4",
  line: "#c7bea9",
  ink: "#0e1a3c",
  body: "#4a4438",
  muted: "#6e6551",
  elevated: "#faf8f3",
  elevatedLine: "#cfc3af",
  action: "#6d4de6",
  onAction: "#ffffff",
  gold: "#c9a227",
  ok: "#4e9a3e",
  warn: "#c9a227",
  danger: "#d9455f",
};

const dark = {
  bg: "#0b1429",
  card: "#0e1a3c",
  soft: "#1a2747",
  line: "#25355c",
  ink: "#f0ebe1",
  body: "#c8d0e4",
  muted: "#8a97b8",
  elevated: "#18264a",
  elevatedLine: "#32456f",
  action: "#6d4de6",
  onAction: "#ffffff",
  gold: "#c9a227",
  ok: "#4e9a3e",
  warn: "#c9a227",
  danger: "#d9455f",
};

export type Palette = typeof light;
export type ThemeMode = "system" | "light" | "dark";

// Lusail carries Arabic and Latin. It ships no 600, and 700 is banned by the
// design, so 600-weight headings use Medium. Mono is JetBrains Mono, as in the
// reference app ("monospace" is not a family on iOS).
export const fonts = {
  light: "Lusail-Light",
  regular: "Lusail-Regular",
  medium: "Lusail-Medium",
  semibold: "Lusail-Medium",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

export const metrics = {
  rail: 20, // hairline rail inset from each edge
  padX: 28, // row horizontal padding — keeps content clear of the rails
  padY: 16,
  gap: 16, // hatched band between rows
  header: 52,
  touch: 44,
  input: 46,
  button: 46,
  radius: { control: 8, chip: 6, sheet: 14 },
  scrim: "rgba(5,10,22,0.72)",
} as const;

export const type = {
  bigHeader: 27,
  title: 20,
  rowTitle: 15,
  body: 14,
  meta: 12,
  micro: 10.5,
  microAr: 11.5,
  tab: 10.5,
} as const;

const STORE_KEY = "zekra.theme";

type ThemeValue = {
  mode: ThemeMode;
  scheme: "light" | "dark";
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  /** The reading theme repainting the app, or null for Zekra's own palette. */
  readingTheme: string | null;
};

const ThemeContext = createContext<ThemeValue>({
  mode: "system",
  scheme: "light",
  palette: light,
  setMode: () => {},
  readingTheme: null,
});

/*
A reading theme repaints the WHOLE app, as on web (MH-366): web's
applyThemeToDocument() rewrites --grid-bg/card/soft/fg/body/muted/line/action
on the document root, so the console chrome turns Dracula along with the note.
paletteFromTheme (features/editor/reading-core.ts) is that same mapping onto
this Palette; the status bar follows the theme's own kind. With no reading
theme the light/dark/system mode below applies as before.

Memoised per theme id + kind, so every consumer gets a stable object.
*/
const themedPalettes = new Map<string, Palette>();

function paletteFor(themeId: string, kind: "light" | "dark"): Palette | null {
  const theme = readingTheme(themeId);
  if (!theme) return null;
  let palette = themedPalettes.get(theme.id);
  if (!palette) {
    palette = paletteFromTheme(theme, kind === "dark" ? dark : light) as Palette;
    themedPalettes.set(theme.id, palette);
  }
  return palette;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const reading = useReadingSettings();

  useEffect(() => {
    void hydrateReading();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await getStored(STORE_KEY);
        if (saved === "system" || saved === "light" || saved === "dark") setModeState(saved);
      } catch {}
    })();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void setStored(STORE_KEY, next);
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const theme = reading.theme ? readingTheme(reading.theme) : null;
    const themed = theme ? paletteFor(theme.id, theme.kind) : null;
    if (theme && themed) {
      return { mode, scheme: theme.kind, palette: themed, setMode, readingTheme: theme.id };
    }
    const scheme: "light" | "dark" = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
    return { mode, scheme, palette: scheme === "dark" ? dark : light, setMode, readingTheme: null };
  }, [mode, system, setMode, reading.theme]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function usePalette(): Palette {
  return useContext(ThemeContext).palette;
}
