import { ReactNode } from "react";
import { ThemeProvider, LanguageProvider, themes } from "@togo-framework/ui";

// Zekra is drawn on the grid (fadymondy.com's design system), which has exactly two themes:
// dark — the default, because memory is read on a dark ground — and light. The kit's other
// presets (purple, rose, emerald…) only recolour --togo-color-* roles that the grid overrides,
// so they are dropped rather than offered as choices that change nothing.
// LanguageProvider supplies EN/AR i18n + RTL.
// The ThemePicker swatch shows each theme's accent — give it Zekra's (light violet on the dark
// ground, the brand violet on ivory) instead of the kit's ToGO cyan and cobalt.
const GRID_THEMES = themes
  .filter((t) => t.id === "dark" || t.id === "light")
  .map((t) => ({ ...t, accent: t.id === "dark" ? "#a98cf5" : "#6d4de6" }));

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider themes={GRID_THEMES}>
      <LanguageProvider initialLanguage="en">{children}</LanguageProvider>
    </ThemeProvider>
  );
}
