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
npm run dist:publish # same, uploaded to GitHub Releases (needs GH_TOKEN) — see "Updates"
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

## Desktop services

Main-process services (`src/main/services.ts` wires them; IPC in `src/shared/ipc.ts`,
payload types in `src/shared/services.ts`). Each has a native form per OS:

| Service | macOS | Windows | Linux |
|---|---|---|---|
| Offline cache + sync | all | all | all |
| Quick Capture panel | NSPanel, `hud` vibrancy, default ⌥⌘N | acrylic (Win 11), default Ctrl+Alt+N | solid, default Ctrl+Alt+N (X11/XWayland) |
| Capture browser tab | AppleScript (Safari, Chromium family, Arc) | — (clipboard) | — (clipboard) |
| Launch at login | login item (+ start hidden) | Run key `--hidden` | XDG autostart `.desktop` |
| App shortcuts | Dock menu (New Note, Quick Capture, recents) | Jump List tasks (`zekra://app/…`) | — |
| Unread badge | Dock badge | taskbar overlay icon | Unity launcher count |
| Share a note | `ShareMenu` (Messages, Mail, AirDrop, Notes) | clipboard / `mailto:` | clipboard / `mailto:` |
| Notification actions | buttons + inline reply | toast buttons (`toastXml`, AUMID) | click only |

Handoff / NSUserActivity, a Services-menu provider and a Share extension are
out of scope (Electron cannot ship app extensions).

**Offline cache.** Pure-JS, no native module (no electron-rebuild, universal
builds and hardened runtime unaffected): atomic JSON documents under
`<userData>/offline-cache/v1/<sha256(api origin + user id)[:16]>/` —
`brains.json`, `queue.json` (outbox, conflicts, id map), `ns/<brain>.json`
(every note with its body), `versions/<brain>.json` (version metadata). Files
are 0600. Sync uses `GET /api/notes?namespace=&since=&cursor=&limit=200`
(oldest change first, tombstones included; the first page's `serverTime` is
the next `since`), pushes with `PUT`/`DELETE` + version (409 → 3-way merge;
title/body changed on both sides keeps both as a "conflicted copy"). It runs
at launch, on focus, every `syncIntervalMinutes` (×3 on battery; paused on
sleep, Low Power Mode, thermal pressure), ~1 s after an edit, and on Sync Now.

**Renderer adoption** (`src/renderer/services/offline.ts`):

- Wired: `features/notes/use-notes-list.ts` (cache-first first page, `offline:<n>`
  cursors, live sync changes) and `features/notes/notes-api.ts` (`saveNote`
  rebases over the app's own pushes and falls back to the outbox; `create` /
  `remove` fall back offline). A queued save returns `ok` with `note.pending`.
- To adopt: show `note.pending` / `useSyncStatus()` in the status bar; follow
  `SyncChangeEvent.idMap` to re-key an open tab whose `local:` note was pushed;
  surface `SyncStatus.conflicts`; brains list from `bridge().offlineBrains()`
  before `zekraApi.brains` (app.tsx); `cachedNote()` before `notesApi.get`
  (workspace `openById`); `shareNote` / `notifyRich` in the note menu / notify
  feature; a proper Settings ▸ Services section (`ServicesSettings` is mounted
  under General for now).

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
  — see "Updates" below.

## Updates

**How it behaves** (`src/main/updater.ts`, policy in `src/main/update-policy.ts`,
UI in `src/renderer/features/updates/`):

- Checks ~8 s after launch and every 6 hours; Help ▸ Check for Updates…, the tray
  item and Settings ▸ About open the **Software Update** sheet and check now.
- An update downloads by itself (`autoDownload`). The **loader** in the sidebar
  footer shows a progress ring and % while it downloads; the sheet shows the bar,
  size, speed, time left and the release notes (the GitHub release body, rendered
  through the markdown pipeline).
- Once downloaded the policy decides, on download and every minute after:
  - **install now** (flush every editor via `window.__zekraFlushAll`, then
    `quitAndInstall`, relaunch) when *Install updates automatically* is on, no
    window has unsaved edits (the workspace's edited flag) and the user is away —
    system idle ≥ 10 min (`powerMonitor.getSystemIdleTime`), or ≥ 1 min with no
    Zekra window on screen (the relaunch then starts hidden, menubar only);
  - otherwise **prompt**: the in-app card "Zekra X.Y.Z is ready — Restart to
    Update / Later" (Later snoozes it for 4 h);
  - with *Install updates automatically* on, a downloaded update also installs
    when you quit (`autoInstallOnAppQuit`).
- **Critical releases**: put `[critical]` anywhere in the GitHub release notes (or
  the release title). The marker is hidden from the notes shown to the user; the
  update is prompted with a native sheet on the main window, its Later only
  snoozes for 1 h, and it always installs on quit — even with auto-install off.
  Unsaved edits still block an unattended install.
- Settings ▸ About: current version, status and last check, Check for Updates /
  Restart to Update, What's New, **channel** (`updateChannel`: *Stable* = full
  releases only; *Beta* = GitHub pre-releases too; never downgrades) and
  **Install updates automatically** (`autoInstallUpdates`, default on).
- Development builds and `--dir` builds (`npm run pack`, no `app-update.yml`)
  never check; the UI says "Updates are available in installed builds". To try
  the flow from source: `ZEKRA_FORCE_UPDATES=1 npm run dev` (reads
  `dev-app-update.yml`; downloads work, installing needs a packaged app).

**Releasing an update**

1. Bump `version` in `package.json` (semver; electron-updater compares it with
   the running app's). A pre-release version (`0.3.0-beta.1`) published as a
   GitHub *pre-release* only reaches the Beta channel.
2. Publish with a GitHub token that can write releases of `fadymondy/zekra`
   (classic PAT with `repo`, or a fine-grained token with *Contents: read and
   write*):

   ```bash
   export GH_TOKEN=ghp_…
   npm run dist:publish         # macOS: dmg + zip + latest-mac.yml (+ blockmaps)
   npm run dist:publish:win     # Windows: NSIS .exe + latest.yml
   npm run dist:publish:linux   # Linux: AppImage + .deb + latest-linux.yml
   npm run dist:publish:all     # all three from one machine (cross-building
                                # Windows/Linux from macOS may need extra tools)
   ```

   electron-builder creates the release `v<version>` (`releaseType: release` in
   `electron-builder.yml`; each run adds its platform's files to the same
   release). Edit the release notes on GitHub — they are what the sheet shows —
   and add `[critical]` for a critical update.
3. **macOS** installs only a **signed** update: Squirrel.Mac checks that the new
   app is signed by the same Developer ID as the running one, and it installs
   from the **zip** (the dmg is for first installs). Notarise it too
   (`APPLE_KEYCHAIN_PROFILE=zekra-notary npm run dist:publish`) or Gatekeeper
   may block the relaunched app. An unsigned build can never update itself.
4. Windows updates are applied by the NSIS installer (silent for unattended
   installs); on Linux the AppImage updates itself (updating a .deb install goes
   through electron-updater's package installer and an admin prompt — untested).
