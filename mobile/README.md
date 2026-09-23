# Zekra Mobile

Expo / React Native client for Zekra on Android and iOS. The first product slice supports:

- password sign-in and authenticator or recovery-code 2FA;
- securely persisted bearer sessions;
- brain listing, selection, and creation;
- searchable notes with create, edit, pin, archive, delete, and version-conflict handling;
- an interactive, sampled knowledge graph with links back to notes;
- automatic light and dark appearance.

## Run locally

Requirements: Node.js 20+, an Android/iOS development environment, and a reachable Zekra API.

```sh
cd mobile
npm install
cp .env.example .env
npm start
```

The default API is `https://app.zekra.dev`. Override it for local development:

```dotenv
EXPO_PUBLIC_ZEKRA_API_URL=http://192.168.1.10:8080
```

Use your computer's LAN address instead of `localhost` when testing on a physical device. Then press `a` for Android or `i` for iOS from Expo, or run a native development build:

```sh
npm run android
npm run ios
```

`npm run ios` requires macOS. Store builds run on Codemagic (`../codemagic.yaml`); `eas.json` has matching development, preview and production profiles.

## Validate

```sh
npm run typecheck
npm run doctor
```

Authentication uses Zekra's native `/api/auth/login` flow rather than browser OAuth, so mobile development does not depend on a localhost OAuth redirect URI. Tokens are stored through Expo SecureStore.

## Firebase, push and releases

Push notifications (FCM), Crashlytics and Analytics need the Firebase config
files in `secrets/` (`GoogleService-Info.plist`, `google-services.json` — never
committed; see `secrets/README.md`). Without them the app still builds and runs,
with those three features off. After adding or removing a file, regenerate the
native projects: `npx expo prebuild --clean`.

- App id **`com.fadymondy.zekra`** (iOS and Android); iOS team **`JW9HJH86GC`**
  (automatic signing; `APPLE_TEAM_ID` overrides).
- `app.config.js` adds what depends on the environment (Firebase per platform,
  team id) on top of `app.json`; config plugins live in `plugins/`.
- Icons are drawn from the brand mark: `node scripts/make-icons.js`.
- Build numbers are stamped by `scripts/set-build-number.js <n>` (CI does this);
  the marketing version is `expo.version`.
- Local TestFlight upload: `scripts/ios-upload.sh <build-number>`.

Full runbook — Firebase project, backend FCM env vars, signing, cutting a
release, store listing checklist: [`docs/mobile-release.md`](../docs/mobile-release.md).

## App updates

`src/features/updates` (mounted once in `app/_layout.tsx`; rules in `update-core.ts`, flow in
`controller.ts`). Two kinds, both no-ops in development builds and on web:

**OTA — Codemagic Patch** (new JS bundle for the same binary; the self-hosted Patch server at
`https://patch.fadymondy.com`, the same stack as fadymondy.com/mobile). Checked at launch and on
foreground (every 30 min at most).

- Optional release: a bottom sheet "Update available — downloading…" with a progress bar, then
  **Restart to update** / **Later**. It is installed `ON_NEXT_RESUME`: if the user does not restart,
  it applies the next time the app comes back after ≥ 10 min in the background.
- Mandatory release (the release's *mandatory* flag on the Patch server, or `--mandatory` on
  `cmpatch release-react`): a full-screen loader (cube mark + progress), installed `IMMEDIATE`, the
  app restarts by itself.
- Never while the note editor is open: the editor keeps its autosave state private
  (`features/editor/autosave-core.ts` has no global getter), so the guard is the route
  (`/note/<id>`) — the update downloads quietly, restarts are suppressed (`disallowRestart`), and it
  applies after the editor closes (mandatory) or on the next resume (optional). The editor can make
  the guard exact with `registerUnsavedWorkProbe()` (`features/updates/unsaved-work.ts`).
- A bundle that crashes before `notifyAppReady()` (called at launch) is rolled back by the SDK and
  never retried.

**Store (native) updates.** Compares `Application.nativeApplicationVersion` with the App Store
(iTunes lookup API, `bundleId=com.fadymondy.zekra`) and with the version manifest served by the web
app — `https://app.zekra.dev/zekra-app.json` (`web/public/zekra-app.json`, per platform
`minimumVersion` / `latestVersion` / optional `storeUrl` / `message`). Android has no public lookup
API, so its "latest" is the manifest's `latestVersion` (or the Patch server's latest binary
version). Newer store version → a sheet "New version available" with **Open App Store / Google
Play** (once per version; *Not now* remembers it). Below `minimumVersion` → a full-screen
**Update required** gate. An unreachable or malformed manifest never blocks anyone. After a store
release is live, bump `latestVersion`; raise `minimumVersion` only to retire old binaries.

Settings → About → Updates: Check for updates, Restart to update (when ready), build, and the update
channel (Patch deployment + the OTA release running, or *built-in*).

### OTA updates (Codemagic Patch) — setup

Until this is done the plugin is left out of the build (`app.config.js`) and OTA is off; nothing
else changes.

1. **Patch apps + deployment keys** (once, with the CLI: `npm i -g @codemagic/patch-cli`):

   ```sh
   cmpatch login --server-url https://patch.fadymondy.com
   cmpatch app create --name zekra --require-code-signing          # iOS
   cmpatch app create --name zekra-android --require-code-signing  # Android
   cmpatch deployment list --app zekra --format table              # DEPLOYMENT_KEY column
   cmpatch deployment list --app zekra-android --format table
   ```

   Each app needs a `Staging` and a `Production` deployment (`cmpatch deployment create` if they
   were not created with the app). A token for CI: `cmpatch token` (→ `CODEMAGIC_PATCH_TOKEN`).
   The app names are the `PATCH_APP_IOS` / `PATCH_APP_ANDROID` vars of the `ota-release` workflow.
2. **Signing key.** The server only insists that bundles are signed; the app verifies them with
   the public key compiled into it. Either reuse the fadymondy.com pair (copy its
   `patch-public-key.pem` here and its `CODEMAGIC_PATCH_PRIVATE_KEY` into `zekra_patch`), or make a
   Zekra pair — never commit the private half:

   ```sh
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out ~/zekra-patch-private.pem
   openssl pkey -in ~/zekra-patch-private.pem -pubout -out patch-public-key.pem   # commit this
   base64 -i ~/zekra-patch-private.pem | pbcopy   # -> CODEMAGIC_PATCH_PRIVATE_KEY
   ```

   `patch-public-key.pem` is a placeholder until then (no PEM block → OTA stays off).
3. **Environment.** Locally in `mobile/.env`, and in Codemagic:
   - `zekra_app_env` (store builds and OTA releases): `PATCH_IOS_PRODUCTION_KEY`,
     `PATCH_IOS_STAGING_KEY`, `PATCH_ANDROID_PRODUCTION_KEY`, `PATCH_ANDROID_STAGING_KEY`;
     optional `PATCH_DEPLOYMENT=Staging` (test binaries; default Production),
     `PATCH_API_URL` / `PATCH_DOWNLOAD_BASE_URL` (default the fadymondy.com server).
   - `zekra_patch` (OTA releases only): `CODEMAGIC_PATCH_SERVER_URL`
     (`https://patch.fadymondy.com`), `CODEMAGIC_PATCH_TOKEN`, `CODEMAGIC_PATCH_PRIVATE_KEY`.
4. **Ship a new store binary** (`ios-release` / `android-release`) — the Patch SDK is native, so
   only binaries built after this carry it. Check `npx expo config --type prebuild --json` shows the
   `@codemagic/react-native-patch` plugin when the keys are set.

**Releasing an OTA update:** run the `ota-release` workflow in Codemagic (`../codemagic.yaml`). It
prebuilds with the store builds' inputs, then `cmpatch release-react --target-binary-version
<app.json expo.version> --bundler expo --private-key-path …` for both apps. Only binaries with that
exact `expo.version` receive it; anything touching native code or config needs a store build.
Locally: the same `cmpatch release-react …` command with `--deployment Staging` against a Staging
binary.
