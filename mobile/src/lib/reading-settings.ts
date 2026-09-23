import { useSyncExternalStore } from "react";

import { THEMES, type ThemeDefinition } from "@shared/markdown/themes/themes";
import {
  DEFAULT_READING,
  coerceReading,
  type ReadingSettings,
} from "@/features/editor/reading-core";
import { getStored, setStored } from "./storage";

export { DEFAULT_READING, FONT_SIZE_RANGE, MAX_WIDTH_OPTIONS, FONT_FAMILY_IDS } from "@/features/editor/reading-core";
export type { ReadingSettings } from "@/features/editor/reading-core";

/*
Reading preferences for notes (MH-266, MH-366): the full web settings shape —
reading theme, font family, size, column width, word wrap, line numbers —
persisted on the device.

The 25+ theme palettes are IMPORTED from the web (themes.ts is pure data with
no imports, the bar for crossing the @shared boundary — see metro.config.js).

A MODULE-LEVEL STORE, not React state. MH-366 ("themes and font size have no
effect") was two consumers that never heard about a change: the settings panel
wrote, the note surface and the app palette did not re-read. Web hit the same
bug and fixed it with a subscription (web/lib/notes/note-settings.ts). Here the
store is read with useSyncExternalStore by everyone — ThemeProvider (which
sits ABOVE ReadingProvider in app/_layout.tsx, so it could not read a context
the provider owns), the note engine, and the settings UI — so one write
repaints all of them.

Persistence is fire-and-forget: a failed Keychain write means the preference
does not survive a restart, which is better than blocking the UI on it.
*/

const KEY = "zekra-reading";
const THEME_IDS = THEMES.map((t) => t.id);

let current: ReadingSettings = { ...DEFAULT_READING };
let hydration: Promise<void> | null = null;
/** Set once the user changes anything, so a slow load cannot clobber it. */
let touched = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getReading(): ReadingSettings {
  return current;
}

export function setReading(next: ReadingSettings): void {
  touched = true;
  current = coerceReading(next, THEME_IDS);
  emit();
  void setStored(KEY, JSON.stringify(current));
}

export function updateReading(patch: Partial<ReadingSettings>): void {
  setReading({ ...current, ...patch });
}

export function subscribeReading(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Load the stored settings once; safe to call from several places. */
export function hydrateReading(): Promise<void> {
  hydration ??= (async () => {
    const raw = await getStored(KEY);
    if (!raw || touched) return;
    try {
      current = coerceReading(JSON.parse(raw), THEME_IDS);
      emit();
    } catch {
      // Corrupt value: keep the defaults.
    }
  })();
  return hydration;
}

/** The live settings; re-renders on every change. */
export function useReadingSettings(): ReadingSettings {
  return useSyncExternalStore(subscribeReading, getReading, getReading);
}

/** Same value with a setter — the shape existing callers use. */
export function useReading(): { reading: ReadingSettings; setReading: (next: ReadingSettings) => void } {
  return { reading: useReadingSettings(), setReading };
}

export function readingTheme(id: string | null): ThemeDefinition | null {
  return id ? (THEMES.find((t) => t.id === id) ?? null) : null;
}

export const READING_THEMES = THEMES;
