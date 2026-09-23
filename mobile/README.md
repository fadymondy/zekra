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
