import { createContext, useContext } from "react";

import { THEMES, type ThemeDefinition } from "@shared/markdown/themes/themes";
import { FONT_SIZE_RANGE } from "@shared/notes/note-settings";
import { getStored, setStored } from "./storage";

/*
Reading preferences for notes on mobile (MH-266): body size and the reading
theme.

The 27 theme palettes are IMPORTED from the web, not copied — themes.ts is
pure data with no imports, which is the bar for anything crossing the @shared
boundary (see metro.config.js). Duplicating them would be ~325 lines of hex
kept in sync by hand.

What is NOT shared is web's note-settings store itself: it is built on
localStorage and a synchronous getSettings(), while mobile persists through
the SecureStore shim, which is async. So the shape below is mobile's own and
deliberately smaller — the editor settings (word wrap, line numbers, autosave)
and the preview max-width have no meaning on a phone, where there is one
column and no editor textarea to wrap.
*/

const KEY = "zekra-reading";

export interface ReadingSettings {
  /** Body text size in px, shared range with web so the two agree on limits. */
  fontSize: number;
  /** Reading theme id, or null for the app's own palette. */
  theme: string | null;
}

export const DEFAULT_READING: ReadingSettings = { fontSize: 16, theme: null };

/** Clamp anything read back off the device — a corrupt value must not make
 *  the note body unreadable. */
function coerce(raw: unknown): ReadingSettings {
  const v = (raw ?? {}) as Partial<ReadingSettings>;
  const size = Number(v.fontSize);
  return {
    fontSize: Number.isFinite(size)
      ? Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, Math.round(size)))
      : DEFAULT_READING.fontSize,
    theme: typeof v.theme === "string" && THEMES.some((t) => t.id === v.theme) ? v.theme : null,
  };
}

export async function loadReading(): Promise<ReadingSettings> {
  const raw = await getStored(KEY);
  if (!raw) return { ...DEFAULT_READING };
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_READING };
  }
}

export async function saveReading(next: ReadingSettings): Promise<void> {
  await setStored(KEY, JSON.stringify(coerce(next)));
}

export function readingTheme(id: string | null): ThemeDefinition | null {
  return id ? (THEMES.find((t) => t.id === id) ?? null) : null;
}

export const READING_THEMES = THEMES;

/** Shared so the settings screen and the note screen see the same value —
 *  the web had the same bug and it cost a round of "it isn't reflected". */
export const ReadingContext = createContext<{
  reading: ReadingSettings;
  setReading: (next: ReadingSettings) => void;
}>({ reading: DEFAULT_READING, setReading: () => {} });

export function useReading() {
  return useContext(ReadingContext);
}
