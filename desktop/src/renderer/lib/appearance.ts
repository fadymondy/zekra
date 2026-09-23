import { applyThemeToDocument, themeById } from "@/lib/markdown/themes/apply";
import {
  coerceSettings,
  getSettings,
  setSettings,
  subscribeSettings,
  watchExternalSettings,
  type NoteSettings,
} from "@/lib/notes/note-settings";

import { bridge } from "./bridge";
import { syncWindowChrome } from "./platform";

/*
Appearance, live in EVERY window (main, note windows, Settings, Spotlight,
New Brain, the Quick Capture panel).

The reading theme and typography live in the web's note-settings store
(localStorage "zekra.note-settings"). Changing them in one window must repaint
all the others at once — before, the theme was applied only by the screens
that mounted <ReadingTheme>, so the window you were in did not change until
you navigated, and the others never did. Now:

  - this window: every store change re-applies the theme variables on <html>
    immediately (and Windows' caption colours), whatever screen is showing;
  - other windows: the change is relayed through main (bridge().broadcast ->
    "reading-settings") AND arrives as a storage event (same origin); either
    one updates their store, whose subscribers (the editors' typography, this
    module's theme) repaint. The JSON of the last value seen stops echoes.

Light / dark / system and the language are AppSettings: main broadcasts every
settings patch to every window (IPC evSettingsChanged, app.tsx).
*/

let installed = false;

function apply(s: NoteSettings): void {
  applyThemeToDocument(themeById(s.theme));
  syncWindowChrome();
}

export function installAppearanceSync(): () => void {
  if (installed) return () => undefined;
  installed = true;
  let last = JSON.stringify(getSettings());
  apply(getSettings());

  const unsubscribe = subscribeSettings((s) => {
    apply(s);
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    void bridge().broadcast?.({ kind: "reading-settings", settings: s });
  });
  const unwatch = watchExternalSettings();
  const off = bridge().onBroadcast?.((msg) => {
    if (msg.kind !== "reading-settings") return;
    const next = coerceSettings(msg.settings);
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    setSettings(next);
  });

  return () => {
    installed = false;
    unsubscribe();
    unwatch();
    off?.();
  };
}
