import { hljsCssFor } from "../../web/lib/markdown/themes/hljsCss.ts";
import { themeById, themeVars } from "../../web/lib/markdown/themes/apply.ts";
import type { EngineDir, EngineTheme, Typography } from "../src/features/editor/bridge-core.ts";
import { fontStack, zekraVars } from "../src/features/editor/engine-core.ts";

/*
Theme + typography for the page.

A reading theme is applied with web's OWN themeVars() and hljsCssFor(), not a
port, so a note looks the same in the web console and on the phone. With no
theme the same --grid-* variables are filled from the app palette RN sends
(engine-core zekraVars), so the stylesheet has one vocabulary either way.
*/

let applied: string[] = [];

export function applyTheme(theme: EngineTheme): void {
  const root = document.documentElement;
  for (const key of applied) root.style.removeProperty(key);
  const definition = themeById(theme.id);
  const vars = definition
    ? { ...zekraVars(theme.colors, definition.kind), ...themeVars(definition) }
    : zekraVars(theme.colors, theme.scheme);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  applied = Object.keys(vars);
  root.style.colorScheme = definition ? definition.kind : theme.scheme;
  root.setAttribute("data-scheme", definition ? definition.kind : theme.scheme);

  // Curated per-theme token colours (15 buckets) layered over the variable
  // rules — the same stylesheet web emits for the theme.
  let style = document.getElementById("zk-hljs-theme") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "zk-hljs-theme";
    document.head.appendChild(style);
  }
  style.textContent = definition ? hljsCssFor(definition) : "";
}

export function applyTypography(t: Typography): void {
  const root = document.documentElement;
  root.style.setProperty("--zk-font", fontStack(t.fontFamily));
  root.style.setProperty("--zk-size", `${t.fontSize}px`);
  root.style.setProperty("--zk-maxw", t.maxWidth > 0 ? `${t.maxWidth}px` : "none");
  root.style.setProperty("--zk-padx", `${Math.max(0, t.padX)}px`);
  root.setAttribute("data-wrap", t.wordWrap ? "on" : "off");
  root.setAttribute("data-lines", t.lineNumbers ? "on" : "off");
}

export function applyDir(dir: EngineDir): void {
  document.documentElement.dir = dir;
}
