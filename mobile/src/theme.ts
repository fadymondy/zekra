import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useColorScheme } from "react-native";

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
// design, so 600-weight headings use Medium.
export const fonts = {
  light: "Lusail-Light",
  regular: "Lusail-Regular",
  medium: "Lusail-Medium",
  semibold: "Lusail-Medium",
  mono: "monospace",
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
};

const ThemeContext = createContext<ThemeValue>({
  mode: "system",
  scheme: "light",
  palette: light,
  setMode: () => {},
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

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
    const scheme: "light" | "dark" = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
    return { mode, scheme, palette: scheme === "dark" ? dark : light, setMode };
  }, [mode, system, setMode]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function usePalette(): Palette {
  return useContext(ThemeContext).palette;
}
