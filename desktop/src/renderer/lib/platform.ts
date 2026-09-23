import { SETTINGS_SECTIONS, type AppInfo, type SettingsSectionId } from "../../shared/ipc";
import { bridge } from "./bridge";

/*
Which OS the app is running on, and how its window is framed
(src/main/window-chrome.ts). One codebase, native per OS — the differences
live in CSS tokens keyed off <html data-platform data-material data-chrome>
(theme.css), plus the few layout facts components need from usePlatform():

  darwin  hiddenInset title bar, traffic lights over the unified toolbar,
          vibrancy source list, SF Pro, sheets from the title bar
  win32   caption-button overlay on the trailing edge, Mica (Win 11),
          Segoe UI Variable, Fluent metrics, the app menu behind "…"
  linux   the window manager's frame, a GTK-style header bar in the content,
          system font, auto-hidden menu bar (Alt)

loadPlatform() runs once before the first render (app.tsx).
*/

export type Platform = "darwin" | "win32" | "linux";

export type PlatformInfo = {
  platform: Platform;
  chrome: NonNullable<AppInfo["chrome"]>;
  material: NonNullable<AppInfo["material"]>;
  titleBarHeight: number;
  windowControls: AppInfo["windowControls"];
  osVersion: string;
};

const FALLBACK: PlatformInfo = {
  platform: "darwin",
  chrome: "hidden-inset",
  material: "none",
  titleBarHeight: 52,
  windowControls: { side: "left", inset: 0 },
  osVersion: "",
};

let current: PlatformInfo = FALLBACK;

function normalize(info: AppInfo): PlatformInfo {
  // The browser preview (no Electron) renders the macOS layout, unframed.
  const platform: Platform = info.platform === "win32" || info.platform === "linux" ? info.platform : "darwin";
  const titleBarHeight = info.titleBarHeight ?? (platform === "win32" ? 40 : platform === "linux" ? 46 : 52);
  return {
    platform,
    chrome: info.chrome ?? (platform === "darwin" ? "hidden-inset" : platform === "win32" ? "overlay" : "frame"),
    material: info.material ?? "none",
    titleBarHeight,
    windowControls: info.windowControls,
    osVersion: info.osVersion ?? "",
  };
}

export function applyPlatform(p: PlatformInfo): void {
  const root = document.documentElement;
  root.dataset.platform = p.platform;
  root.dataset.chrome = p.chrome;
  root.dataset.material = p.material;
  if (p.osVersion) root.dataset.osVersion = p.osVersion;
  root.style.setProperty("--titlebar-h", `${p.titleBarHeight}px`);
}

export async function loadPlatform(): Promise<PlatformInfo> {
  try {
    current = normalize(await bridge().getAppInfo());
  } catch {
    current = FALLBACK;
  }
  applyPlatform(current);
  return current;
}

export function usePlatform(): PlatformInfo {
  return current;
}

export type WindowKind =
  | { kind: "main" }
  | { kind: "note"; ns: string; id: string }
  /** A new note (native-ui.ts openNewNoteWindow); `ns` preselects the brain. */
  | { kind: "note-new"; ns: string | null }
  | { kind: "settings"; section: SettingsSectionId | null }
  | { kind: "spotlight" }
  | { kind: "new-brain" };

/** Which window this renderer is: every window loads index.html and names
 *  itself with `?window=` (src/main/native-ui.ts, src/main/app-windows.ts). */
export function windowKind(): WindowKind {
  const q = new URLSearchParams(location.search);
  const ns = q.get("ns");
  const id = q.get("id");
  switch (q.get("window")) {
    case "note":
      return ns && id ? { kind: "note", ns, id } : { kind: "main" };
    case "note-new":
      return { kind: "note-new", ns: ns || null };
    case "settings": {
      const section = q.get("section");
      return { kind: "settings", section: (SETTINGS_SECTIONS as readonly string[]).includes(section ?? "") ? (section as SettingsSectionId) : null };
    }
    case "spotlight":
      return { kind: "spotlight" };
    case "new-brain":
      return { kind: "new-brain" };
    default:
      return { kind: "main" };
  }
}

/** CSS colour (any syntax the engine resolves to rgb/rgba) -> #rrggbbaa. */
function toHex(css: string): string | null {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return null;
  const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(+r)}${h(+g)}${h(+b)}${h(+a * 255)}`;
}

/** Windows: the native caption buttons are drawn by the OS and cannot read
 *  CSS — hand them the theme's colours (transparent over Mica). Runs after
 *  every theme / reading-theme change. */
export function syncWindowChrome() {
  if (document.documentElement.dataset.platform !== "win32" || !bridge().setWindowChrome) return;
  requestAnimationFrame(() => {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--grid-fg);background:var(--grid-card)";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const fg = toHex(cs.color);
    const bg = document.documentElement.dataset.material === "mica" ? "#00000000" : toHex(cs.backgroundColor);
    probe.remove();
    if (fg && bg) void bridge().setWindowChrome?.({ background: bg, foreground: fg.slice(0, 7) });
  });
}
