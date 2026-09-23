# Zekra for macOS (ذكرة)

A native Electron client of the Zekra brain/notes API (`https://app.zekra.dev` by
default; changeable in Settings ▸ General). It is not a browser wrapper: the only
page ever loaded is the app's own bundled renderer (`out/renderer/index.html`),
and every API call is made by the main process (`src/main/api-proxy.ts`) because
a `file://` page sends `Origin: null`, which the API rejects (MH-269).

It replaces the Mark It Down app (epic MH-450) and follows its native-macOS
patterns: hidden-inset title bar with an 80px traffic-light inset, full native
menu, menubar item, Finder integration for Markdown files.

## Commands

```bash
npm install          # desktop deps (electron, esbuild, electron-builder, …)
                     # the renderer's React/shadcn/Tailwind come from ../web —
                     # run `npm install` in ../web too
npm run dev          # build (with source maps) and launch
npm run typecheck    # main + renderer, both strict
npm run build        # out/ (main via tsc, preload + renderer via esbuild)
npm run pack         # signed, unpacked app: dist/mac-arm64/Zekra.app
npm run dist         # dmg + zip, universal, signed (+ notarised if configured)
npm run dist:publish # same, uploaded to GitHub Releases (needs GH_TOKEN)
npm run icons        # regenerate build/icon.icns + tray icons from build/icon.svg
```

If your shell exports `ELECTRON_RUN_AS_NODE=1` (some tool hosts do), Electron
starts as plain Node and `require("electron").app` is undefined — unset it.

## Layout

```
src/shared/ipc.ts      THE contract: settings schema, command names, events,
                       IPC channel names, the typed window.zekra API
src/shared/csp.ts      the renderer CSP (meta tag + response header)
src/main/              main process (see the module map atop main.ts)
  main.ts              lifecycle, single-instance lock, main window
  ipc-handlers.ts      every ipcMain.handle
  renderer-events.ts   main -> renderer events, buffered until renderer ready
  menu.ts / menu-strings.ts   native menu, EN/AR, -> command bus
  deep-links.ts        zekra:// + open-file (.md/.markdown/.mdx)
  settings-store.ts    electron-store + safeStorage-encrypted session token
  window-state.ts      persisted bounds / maximised / full screen
  tray.ts              menubar item
  updater.ts           electron-updater (GitHub fadymondy/zekra)
  security.ts          CSP header, permission policy
  preload.ts           exposes window.zekra (bundled by esbuild)
src/renderer/          React 19 renderer
  app.tsx              providers + session restore
  shell/               app chrome and the extension points (below)
  routes/              one file per route
  screens/             sign-in, the notes workspace
  components/, lib/    avatar, markdown, api client, i18n, authed images
build/                 bundle.mjs, icons, entitlements
```

Aliases (build/bundle.mjs and tsconfig.renderer.json agree):
`@/` → `../web` (shadcn components, web lib) and `@mobile/` → `../mobile/src`
(pure-TS modules shared with the phone app, e.g. i18n dictionaries).

## Extending the shell (feature teams)

- **Screens** — add a variant to `Route` in `shell/router.tsx`, render it in
  `routes/index.tsx` (exhaustive switch). Navigate with `useRouter().navigate()`.
- **Activity bar** — append to `ACTIVITY_ITEMS` in `shell/activity-bar.tsx`.
- **Title / status bar items** — `useSlot(name, node, { order })` from
  `shell/slots.tsx`. Slots: `titlebar.start`, `titlebar.end`,
  `titlebar.bell` (replaces the default bell), `titlebar.account` (replaces the
  default account menu), `statusbar.start`, `statusbar.end`.
- **Menu commands** — `useCommand("export:pdf", handler)` from
  `shell/commands.tsx`. Latest-mounted handler wins; return `false` to pass
  down. Shell fallbacks and TODO(feature-team) stubs: `shell/base-commands.tsx`.
- **OS events** — `useOsEvent("deep-link" | "open-file" | "notification-click", fn)`
  from `shell/os-events.tsx`. Unhandled events are parked and delivered to the
  first handler that mounts.
- **Toasts** — `import { toast } from "shell/toast"`.
- **Authenticated images** — `useAuthedImage(path)` from `lib/authed-image.ts`
  (bytes fetched by main with the stored token; returns an object URL).
- **Strings** — `t(key, vars)` from `lib/i18n.tsx`. Mobile's feature dictionaries
  (`mobile/src/i18n/features/*`) are merged in; reuse their keys.

## Settings and secrets

Local settings live in
`~/Library/Application Support/zekra-desktop/zekra-desktop-settings.json` (the
userData dir follows package.json `name`; dev and packaged builds share it).
Schema: `AppSettings` in `src/shared/ipc.ts`. The session token is encrypted with Electron `safeStorage`
(key in the login Keychain) and stored as `authTokenEnc`; plain tokens written by
older builds are migrated on first launch. A token encrypted by a differently
signed build (dev Electron vs the signed app) may not decrypt; it is then
dropped and the user signs in again.

## Signing, notarisation, updates

- App id `com.fadymondy.zekra.desktop` (distinct from the iOS bundle id).
- Signed with **Developer ID Application: Fady Nasef (JW9HJH86GC)**, pinned by
  SHA-1 `5697A4668C164256E390AC317BBF76ADC5D1892A` in `electron-builder.yml`. Two
  certificates with that exact name exist in the login keychain (the other is
  `D3DA7066B6C287DBBE9E43FCE0E483EF7F2C4DC3`; both valid, both with a key, same
  expiry), so signing by name is ambiguous. Override per build with
  `-c.mac.identity=<sha1>` (`mac.identity` takes precedence over `CSC_NAME`), or
  `-c.mac.identity=null` for an unsigned build; on a machine without the
  certificate electron-builder skips signing with a warning.
- Hardened runtime with `build/entitlements.mac.plist` (JIT, unsigned executable
  memory, network client, user-selected files).
- Notarisation runs only when credentials are in the environment:
  `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or
  `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`, or
  `APPLE_KEYCHAIN_PROFILE` (a `xcrun notarytool store-credentials` profile).
- Auto-update: `electron-updater` against GitHub Releases of `fadymondy/zekra`
  (needs the signed zip target, i.e. `npm run dist:publish`). Packaged builds check
  once after launch; Help ▸ Check for Updates… checks interactively. Development
  builds never check.
