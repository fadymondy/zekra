// app.json stays the source of truth; this only adds what depends on the build environment and on
// files that are not in git.
//
// Firebase (push, Crashlytics, Analytics): the config files live in secrets/ (gitignored — see
// secrets/README.md; Codemagic decodes them from secure variables before prebuild). Each platform is
// wired only when ITS file exists (plugins/with-firebase.js), so a checkout or CI run without them
// still prebuilds and runs — with Firebase off rather than a crash at launch.
//
// Apple team: automatic signing under JW9HJH86GC (the team of engfadymondy@gmail.com), overridable
// with APPLE_TEAM_ID; prebuild writes it as DEVELOPMENT_TEAM into the Xcode project.
const fs = require("fs");
const path = require("path");

const IOS_FIREBASE = "./secrets/GoogleService-Info.plist";
const ANDROID_FIREBASE = "./secrets/google-services.json";
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || "JW9HJH86GC";

const has = (rel) => fs.existsSync(path.join(__dirname, rel));

// Google sign-in (@react-native-google-signin/google-signin). The iOS URL scheme is the reversed iOS
// client id; it has to be in Info.plist at prebuild time, so it comes from the build environment
// (mobile/.env locally, Codemagic's environment in CI). Without it the plugin is left out rather than
// baking in a wrong scheme — and the app hides the Google button (src/features/social/google.ts).
const GOOGLE_IOS_URL_SCHEME = process.env.GOOGLE_IOS_URL_SCHEME || process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

// Codemagic Patch — OTA JS updates from the self-hosted Patch server (the same stack as
// fadymondy.com/mobile). One Patch app per platform, each with Staging and Production deployments;
// deployment keys are public identifiers (they ship inside the binary) and come from the build
// environment (mobile/.env locally, Codemagic's zekra_app_env group in CI). Store builds use
// Production; PATCH_DEPLOYMENT=Staging makes a test binary. Releases must be signed: the public key
// is committed as patch-public-key.pem, the private key lives only in Codemagic (zekra_patch group).
//
// The plugin is left out — and the app's updater stays off (src/features/updates) — unless a
// platform has a deployment key AND patch-public-key.pem holds a real key, so a checkout, a dev
// build or a CI run without them prebuilds exactly as before. Setup: mobile/README.md → "OTA
// updates (Codemagic Patch)".
const PATCH_DEPLOYMENT = process.env.PATCH_DEPLOYMENT === "Staging" ? "Staging" : "Production";
const PATCH_KEYS = {
  ios: { Staging: process.env.PATCH_IOS_STAGING_KEY, Production: process.env.PATCH_IOS_PRODUCTION_KEY },
  android: { Staging: process.env.PATCH_ANDROID_STAGING_KEY, Production: process.env.PATCH_ANDROID_PRODUCTION_KEY },
};
const PATCH_SERVER = {
  apiUrl: process.env.PATCH_API_URL || "https://patch.fadymondy.com",
  downloadBaseUrl: process.env.PATCH_DOWNLOAD_BASE_URL || "https://storage-patch.fadymondy.com/codemagic-patch",
};

/** The PEM block of patch-public-key.pem, or null while it is still the placeholder. LF only: a
 *  Windows checkout gives the file CRLF, which would end up inside the embedded key. */
function patchPublicKey() {
  if (!has("patch-public-key.pem")) return null;
  const text = fs.readFileSync(path.join(__dirname, "patch-public-key.pem"), "utf8").replace(/\r\n?/g, "\n");
  const m = text.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
  return m ? m[0].trim() : null;
}

function patchConfig() {
  const key = (platform) => (PATCH_KEYS[platform][PATCH_DEPLOYMENT] || "").trim();
  const ios = key("ios");
  const android = key("android");
  if (!ios && !android) return { plugin: null, extra: { enabled: false, ios: false, android: false, deployment: PATCH_DEPLOYMENT } };
  const publicKey = patchPublicKey();
  if (!publicKey) {
    console.warn("[app.config] PATCH_* deployment keys are set but patch-public-key.pem has no key: OTA updates stay OFF (unsigned releases are never accepted). See mobile/README.md.");
    return { plugin: null, extra: { enabled: false, ios: false, android: false, deployment: PATCH_DEPLOYMENT } };
  }
  const block = (deploymentKey) => ({ deploymentKey, ...PATCH_SERVER, publicKey });
  return {
    plugin: ["@codemagic/react-native-patch", { ...(ios ? { ios: block(ios) } : {}), ...(android ? { android: block(android) } : {}) }],
    extra: { enabled: true, ios: Boolean(ios), android: Boolean(android), deployment: PATCH_DEPLOYMENT },
  };
}

module.exports = ({ config }) => {
  const ios = has(IOS_FIREBASE);
  const android = has(ANDROID_FIREBASE);
  const patch = patchConfig();
  return {
    ...config,
    ios: {
      ...config.ios,
      appleTeamId: APPLE_TEAM_ID,
      // Sign in with Apple entitlement. App Review 4.8: the app offers Google/GitHub sign-in, so it
      // must offer Sign in with Apple too. The App ID needs the "Sign in with Apple" capability.
      usesAppleSignIn: true,
      ...(ios ? { googleServicesFile: IOS_FIREBASE } : {}),
    },
    android: {
      ...config.android,
      ...(android ? { googleServicesFile: ANDROID_FIREBASE } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ["./plugins/with-firebase", { ios, android, notificationIcon: "./assets/notification-icon.png", notificationColor: "#6D4DE6" }],
      "expo-apple-authentication",
      "expo-web-browser",
      ...(GOOGLE_IOS_URL_SCHEME ? [["@react-native-google-signin/google-signin", { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }]] : []),
      ...(patch.plugin ? [patch.plugin] : []),
    ],
    extra: {
      ...config.extra,
      // Which platforms this build was configured with; for diagnostics only — the app decides
      // at runtime from the native Firebase app (src/lib/crash.ts firebaseReady()).
      firebase: { ios, android },
      // Which platforms this binary was built with Codemagic Patch for, and the deployment
      // (src/features/updates/patch.ts reads it; OTA stays off when disabled).
      patch: patch.extra,
    },
  };
};
