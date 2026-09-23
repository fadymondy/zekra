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

module.exports = ({ config }) => {
  const ios = has(IOS_FIREBASE);
  const android = has(ANDROID_FIREBASE);
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
    ],
    extra: {
      ...config.extra,
      // Which platforms this build was configured with; for diagnostics only — the app decides
      // at runtime from the native Firebase app (src/lib/crash.ts firebaseReady()).
      firebase: { ios, android },
    },
  };
};
