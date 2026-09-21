# Zekra Desktop

A native Electron notes app backed by Zekra's own brain/notes REST API
(`https://app.zekra.dev` by default, configurable in Settings). This is **not** a
browser wrapper — the only thing ever loaded into the `BrowserWindow` is this app's
own bundled renderer (`out/renderer/index.html`); every Zekra API call goes out via
plain `fetch` from the renderer, the same way `mobile/src/lib/api.ts` does from React
Native.

Architecture mirrors `E:\Sites\mark-it-down\apps\electron` (main/preload/renderer
split, `electron-builder` packaging) and its theme system
(`packages/core/src/themes/themes.ts` — a pluggable array of named palettes), but the
notes/auth logic and the theme colors are Zekra's own.

## Layout

- `src/main/main.ts` — app lifecycle, BrowserWindow, IPC handlers for local settings.
- `src/main/preload.ts` — the only bridge exposed to the renderer (`window.zekra`):
  local settings get/patch, session clear, app version, safe `openExternal`, and
  native-menu event relays. No filesystem/Node access is exposed beyond that.
- `src/main/menu.ts` — native app menu (Zekra / Note / Edit / View / Window / Help).
- `src/main/settings-store.ts` — `electron-store`-backed local settings (API base URL,
  theme, active brain, session token/user). Never sent to the backend.
- `src/renderer/*.ts` — vanilla TS (no framework/bundler), compiled 1:1 by `tsc` to
  `out/renderer/*.js` and loaded via plain `<script>` tags in dependency order
  (`themes.js`, `api.js`, `app.js`) — same pattern as mark-it-down's renderer.
  - `themes.ts` — the theme system: `zekra-light` / `zekra-dark` / `zekra-gold`,
    applied as CSS custom properties.
  - `api.ts` — the Zekra API client, mirroring `mobile/src/lib/api.ts`'s contract
    (bearer-token auth, CSRF-then-login, `/api/brain/mine`, `/api/notes*`) with
    `source: "desktop"` instead of `"mobile"`.
  - `app.ts` — the SPA: sign-in -> brain picker -> notes list + editor, plus Settings.
- `build/icon.svg` / `build/icon.png` — the real cabrain/Zekra brand mark (see
  `web/app/icon.svg`), redrawn on the dark-ink ground per the brand's square-corner,
  no-gradient rule.

## Run it

```bash
cd desktop
npm install
npm run dev      # builds main+renderer, then launches electron .
```

Point at a different backend at runtime via Settings (gear icon / Zekra menu ->
Settings…), or by pre-seeding the `apiBaseUrl` field in the local settings file
(`electron-store` writes to the OS's per-user config dir, e.g.
`%APPDATA%/zekra-desktop-settings/zekra-desktop-settings.json` on Windows).

## Typecheck / build only

```bash
npm run typecheck   # tsc --noEmit for both main and renderer
npm run build        # tsc (main + renderer) -> out/
```

## Package installers

```bash
npm run package
```

Produces Windows (NSIS installer + portable exe), macOS (`.dmg`), and Linux
(AppImage + `.deb`) artifacts in `dist/`, via `electron-builder.yml`.

**Known gap:** no image-conversion tool (ImageMagick, rsvg-convert, Inkscape, sharp)
was available in this environment, so there is no real multi-resolution `.ico`/`.icns`
yet — `electron-builder.yml` references `build/icon.ico` / `build/icon.icns`, which
don't exist. Before a real Windows/macOS package build, generate them from
`build/icon.png`, e.g.:

```bash
npx electron-icon-builder --input=build/icon.png --output=build --flatten
```

Linux packaging works as-is since `linux.icon` points at the already-generated
`build/icon.png`.
