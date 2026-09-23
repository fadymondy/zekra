# Mobile release runbook (MH-373)

How the Zekra phone app (`mobile/`, Expo 57 / React Native) gets Firebase (push,
Crashlytics, Analytics), how the server sends push, and how a build reaches
TestFlight and Google Play.

| | |
|---|---|
| iOS bundle id / Android package | **`com.fadymondy.zekra`** (both) |
| Apple team | **`JW9HJH86GC`** (engfadymondy@gmail.com) — automatic signing |
| Marketing version | `expo.version` in `mobile/app.json` (bump by hand per release) |
| Build number | `ios.buildNumber` / `android.versionCode`, stamped by `mobile/scripts/set-build-number.js` (CI: Codemagic `$BUILD_NUMBER`) |
| CI | `codemagic.yaml` (repo root) — `ios-release`, `android-release` |
| Local iOS upload | `mobile/scripts/ios-upload.sh <build-number>` |

The app builds and runs **without** any Firebase file: push, Crashlytics and
Analytics are then off (every call is guarded), nothing crashes. Store builds
must have both files.

---

## 1. Firebase project

1. <https://console.firebase.google.com> → **Add project** → `Zekra`. Google
   Analytics: **on**, a new GA4 property; in its *Data sharing settings* turn
   everything off, and in GA4 → Admin → Data collection leave **Google signals
   off** and **ads personalisation off** (the app declares no tracking).
2. **Add app → iOS**: bundle id `com.fadymondy.zekra`, App Store ID once the
   App Store Connect record exists. Download **`GoogleService-Info.plist`**.
3. **Add app → Android**: package `com.fadymondy.zekra`. (SHA fingerprints are
   not needed for FCM/Crashlytics/Analytics.) Download **`google-services.json`**.
4. Put both files in **`mobile/secrets/`** (gitignored; see
   `mobile/secrets/README.md`). `mobile/app.config.js` wires each platform only
   when its file exists (`mobile/plugins/with-firebase.js`).
5. **Crashlytics** → *Get started* (enables the product; the first report
   appears after a release build crashes/reports and is relaunched).
6. **Cloud Messaging → Apple app configuration → APNs Authentication Key**:
   Apple Developer → Certificates, IDs & Profiles → **Keys** → *+* → enable
   **Apple Push Notifications service (APNs)** → download the `.p8`. Upload it
   with its **Key ID** and **Team ID `JW9HJH86GC`**. One key serves sandbox and
   production. (Without it iOS devices get FCM tokens but never receive pushes.)
7. Google Cloud console of the same project → **APIs & Services** → make sure
   **Firebase Cloud Messaging API (V1)** is enabled.

For CI, base64 both files into the Codemagic group `zekra_app_env`:

```sh
base64 -i mobile/secrets/google-services.json | pbcopy        # → GOOGLE_SERVICES_JSON (secure)
base64 -i mobile/secrets/GoogleService-Info.plist | pbcopy    # → GOOGLE_SERVICE_INFO_PLIST (secure)
```

### Local builds with Firebase

```sh
cd mobile
npx expo prebuild --clean      # regenerate ios/ + android/ after adding/removing a secrets file
npx expo run:ios --device      # or: npx expo run:android
```

iOS push needs a real device (the simulator has no APNs token). The iOS
entitlement defaults to `aps-environment = production` (what App Store /
TestFlight builds need); for a debug build signed with a development profile set
`APS_ENVIRONMENT=development` before prebuild if Xcode reports an
`aps-environment` mismatch.

---

## 2. Backend push (plugins/brain)

The server sends through **FCM HTTP v1** with a service-account key (JWT →
OAuth access token, cached for its hour). With no key configured push is a
no-op, logged once at first use (`push: FCM is not configured …`).

Firebase console → Project settings → **Service accounts** → *Generate new
private key* (or a dedicated service account with role **Firebase Cloud
Messaging API Admin**, `roles/firebasecloudmessaging.admin`).

| Env var | Meaning |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | The key: raw JSON **or** base64 of it (preferred in env UIs). Literal `\n` in `private_key` is accepted. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the same JSON file; used only when `FCM_SERVICE_ACCOUNT_JSON` is unset. |
| `FCM_PROJECT_ID` | Optional override of the key's `project_id`. |
| `FCM_DRY_RUN=1` | Optional: FCM validates every message (`validate_only`) and delivers none — for staging. |

(These are app-server env vars, next to the others in `DEPLOY.md`.)

Endpoints (session users only — bearer session or cookie + CSRF; also behind the
harness `RequireSession` for `/api/me/*`):

| | |
|---|---|
| `POST /api/me/device_tokens` `{token, platform: ios\|android, user_agent?, locale?: en\|ar}` | register / re-register this device (a token that belonged to another account moves to the caller) |
| `POST /api/me/device_tokens/unregister` `{token}` | remove this device (sign-out, or notifications turned off) |
| `GET /api/me/device_tokens` | the caller's devices, tokens masked, plus `push_configured` |
| `POST /api/me/device_tokens/test` | a test notification to the caller's devices; `503 push_not_configured` without a key; 1 per 10 s |

Notifications the server sends (async, 30 s budget, never blocking the request):

- **brain shared with you** — a user is added to a brain (`POST /api/brain/members`, new members only) → route `/brain/<ns>`;
- **presentation opened** — a presentation share link is opened for the first time by someone other than its owner → the owner, route `/presentation/<id>`.

Text is English or Arabic per device (`locale` sent at registration). Tokens FCM
reports dead (`UNREGISTERED`, `SENDER_ID_MISMATCH`, invalid token) are deleted.
Tables: `device_tokens`, `push_once` (`plugins/brain/internal/brain/schema.sql`,
applied by `zekractl migrate`).

**Check it end to end:** TestFlight build → Settings → Notifications → on →
*Send a test notification*.

---

## 3. Signing

### iOS
- Automatic signing under team `JW9HJH86GC`; `ios.appleTeamId` is set by
  `mobile/app.config.js` (override with `APPLE_TEAM_ID`), so prebuild writes
  `DEVELOPMENT_TEAM` into the Xcode project.
- App Store Connect → **My Apps → +** → iOS app, bundle id `com.fadymondy.zekra`
  (register the App ID first in the developer portal if it is not offered; enable
  **Push Notifications** on it — automatic signing adds it too).
- **Codemagic:** Team → Integrations → *App Store Connect* → add an API key
  (App Store Connect → Users and Access → Integrations → Keys, role *App
  Manager*) named **`zekra_asc`**. `ios_signing` in `codemagic.yaml` then fetches
  or creates the distribution certificate and App Store profile.
- **Local:** Xcode signed in to the team's Apple ID, then
  `mobile/scripts/ios-upload.sh <build>` — `xcodebuild archive
  -allowProvisioningUpdates` and `-exportArchive` with
  `mobile/scripts/ios/ExportOptions.plist` (`app-store-connect`, `upload`,
  team `JW9HJH86GC`, automatic). `--no-upload` exports an `.ipa` only. An API
  key instead of the Xcode account: `ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`.

### Android
- Create the **upload key** once and keep it out of git:
  ```sh
  keytool -genkeypair -v -storetype JKS -keystore zekra-upload.jks -alias zekra-upload \
    -keyalg RSA -keysize 2048 -validity 10000
  ```
- Play Console → create the app `com.fadymondy.zekra` → enrol in **Play App
  Signing** (Google holds the app signing key; this is the upload key).
- Codemagic group **`zekra_android_keystore`**: `CM_KEYSTORE` (base64 of the
  `.jks`), `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD`.
  `mobile/plugins/with-release-signing.js` signs `bundleRelease` with them (and
  falls back to debug signing locally, when they are absent).
- Play API uploads (optional): a Google Cloud service account with Play Console
  access → group `zekra_google_play` (`GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`),
  then uncomment `google_play` in `codemagic.yaml`. Play only accepts API uploads
  **after the first `.aab` was uploaded by hand**.

---

## 4. Cutting a release

1. Bump `expo.version` in `mobile/app.json` (e.g. `0.2.0`) and commit. Do not
   edit `buildNumber` / `versionCode` — CI stamps them.
2. Codemagic → start **`ios-release`** (→ TestFlight) and **`android-release`**
   (→ `.aab` artifact; Play internal track as a **draft** once API upload is on).
   Both: `npm ci` → decode secrets → `set-build-number.js $BUILD_NUMBER` →
   `expo prebuild --clean` → build → publish.
3. First Android release: download the `.aab` artifact and upload it in Play
   Console → Testing → Internal testing.
4. TestFlight: wait for processing, add testers; answer the export-compliance
   question once (it is pre-answered by `ITSAppUsesNonExemptEncryption = false`:
   the app only uses HTTPS and the OS keychain).
5. Smoke test: sign in, notifications on + test push, open a pushed link, a
   crash report reaching Crashlytics (Crashlytics → issues), Analytics
   DebugView (launch with `-FIRDebugEnabled` / `adb shell setprop debug.firebase.analytics.app com.fadymondy.zekra`).
6. Submit for review from App Store Connect / promote in Play Console.

Icons are generated from the brand mark: `node mobile/scripts/make-icons.js`
(App Store 1024 opaque, Android adaptive foreground/monochrome, notification
icon, `assets/store/play-icon-512.png`).

---

## 5. Store listing checklist

**Both stores**
- [ ] Name `Zekra`; short description / subtitle; full description in **English and Arabic**.
- [ ] Category **Productivity**.
- [ ] Privacy policy URL **https://zekra.dev/en/legal/privacy** (the page the
      app's Settings → Privacy opens — confirm it is live before submitting);
      terms https://zekra.dev/en/legal/terms; support URL **https://zekra.dev/en/support**.
- [ ] **Reviewer account**: the app requires sign-in — give App Review / Play a
      working demo account (email + password, no 2FA) with a brain that has notes.
- [ ] Account deletion: in the app (Settings → Delete account) — both stores
      require it; Play also asks for a web URL where deletion can be requested.
- [ ] Screenshots in **English and Arabic** (RTL).

**App Store**
- [ ] Screenshots: iPhone **6.9"** (1320 × 2868 or 1290 × 2796 portrait) — the
      required set; 6.5" (1284 × 2778 / 1242 × 2688) optional. **No iPad set**:
      `ios.supportsTablet` is `false` (see below).
- [ ] Age rating questionnaire: no objectionable content → **4+**.
- [ ] App Privacy ("nutrition label"), matching `ios.privacyManifests` in app.json:
      - Contact Info → **Email address**, **Name** — linked to the user, App Functionality.
      - User Content → **Other user content** (notes, brains), **Photos** (images the user adds to notes) — linked, App Functionality.
      - Identifiers → **Device ID** (FCM / Firebase installation id) — linked, App Functionality + Analytics.
      - Usage Data → **Product interaction** — not linked, Analytics.
      - Diagnostics → **Crash data**, **Other diagnostic data** — not linked, App Functionality.
      - Tracking: **No** (no IDFA, no ATT prompt, no data brokers).
- [ ] Export compliance: exempt (`ITSAppUsesNonExemptEncryption = false`).

**Google Play**
- [ ] Icon 512 × 512 (`mobile/assets/store/play-icon-512.png`), feature graphic 1024 × 500.
- [ ] Phone screenshots: 2–8, PNG/JPEG, 16:9 or 9:16, each side 320–3840 px (1080 × 1920 is safe).
- [ ] Content rating (IARC): utility/productivity, no violence etc.; users can
      share content with invited members → "Users interact". Expected **Everyone**.
- [ ] Target audience: **18+** (keeps the app out of the Families policy).
- [ ] Ads: **No ads**. Advertising ID: **not used** (the AD_ID permission is removed in app.json).
- [ ] Data safety form:
      - Data collected: **Personal info → Email address, Name** (account management, app functionality; required);
        **App activity → App interactions** (analytics); **App activity → Other user-generated content** (app functionality);
        **Photos and videos → Photos** (app functionality; optional — only when the user adds one);
        **App info and performance → Crash logs, Diagnostics** (analytics / app functionality);
        **Device or other IDs** (push delivery; analytics).
      - Shared with third parties: **No** (Firebase is a service provider processing on our behalf).
      - Encrypted in transit: **Yes**. Users can request deletion: **Yes** (in-app + URL).
- [ ] App access: provide the reviewer credentials under *App access*.

**Why `supportsTablet: false`:** every screen is a portrait phone layout
(`orientation: portrait`). A tablet build would have to support every
orientation for iPad multitasking (or opt out with `UIRequiresFullScreen`), ship
an iPad screenshot set and pass review on iPad layouts that have never been
designed. iPad users can still install the iPhone app (it runs in
compatibility mode). Revisit when there is an iPad layout.

---

## 6. What the app declares (for reference)

- **Permissions** — Android: `POST_NOTIFICATIONS`, `USE_BIOMETRIC`,
  `USE_FINGERPRINT`, `VIBRATE` (+ `INTERNET`); removed: `AD_ID`,
  `ACCESS_ADSERVICES_*`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`. iOS: Face ID and
  photo-library usage strings (from their plugins); push entitlement and
  `UIBackgroundModes: remote-notification` only in Firebase-configured builds.
- **Notification permission is never requested at launch** — only when the user
  turns notifications on in Settings.
- **Analytics** logs screens by route pattern (`/note/[id]`, never ids) and a few
  named actions; never note text, titles, secret names, emails or queries
  (`mobile/src/lib/analytics.ts`). No user id is sent to Crashlytics or Analytics.
- `firebase.json`: Crashlytics off in debug builds; Analytics without ad id /
  SSAID / ad storage / ad personalisation; automatic screen reporting off.
