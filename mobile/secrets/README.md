# secrets/

Files here are **never committed** (see `mobile/.gitignore`). The app builds and
runs without any of them — Firebase (push, Crashlytics, Analytics) is simply off.

| File | What | Used by |
|------|------|---------|
| `GoogleService-Info.plist` | Firebase iOS app config (`com.fadymondy.zekra`) | `app.config.js` → `plugins/with-firebase.js` (iOS) |
| `google-services.json` | Firebase Android app config (`com.fadymondy.zekra`) | `app.config.js` → `plugins/with-firebase.js` (Android) |
| `play-service-account.json` | Google Play API key (optional) | `eas submit` only |

Download the two Firebase files from the Firebase console (Project settings →
Your apps). On Codemagic they are written here from the `zekra_app_env` group
(`GOOGLE_SERVICE_INFO_PLIST`, `GOOGLE_SERVICES_JSON`, both base64). Full steps:
`docs/mobile-release.md`.

After adding or removing a file, regenerate the native projects
(`npx expo prebuild --clean` or `npx expo run:ios|android`).
