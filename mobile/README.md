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

`npm run ios` requires macOS. Cloud builds are configured in `eas.json` for development, preview, and production profiles.

## Validate

```sh
npm run typecheck
npm run doctor
```

Authentication uses Zekra's native `/api/auth/login` flow rather than browser OAuth, so mobile development does not depend on a localhost OAuth redirect URI. Tokens are stored through Expo SecureStore.
