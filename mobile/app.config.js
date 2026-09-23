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

module.exports = ({ config }) => {
  const ios = has(IOS_FIREBASE);
  const android = has(ANDROID_FIREBASE);
  return {
    ...config,
    ios: {
      ...config.ios,
      appleTeamId: APPLE_TEAM_ID,
      ...(ios ? { googleServicesFile: IOS_FIREBASE } : {}),
    },
    android: {
      ...config.android,
      ...(android ? { googleServicesFile: ANDROID_FIREBASE } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ["./plugins/with-firebase", { ios, android, notificationIcon: "./assets/notification-icon.png", notificationColor: "#6D4DE6" }],
    ],
    extra: {
      ...config.extra,
      // Which platforms this build was configured with; for diagnostics only — the app decides
      // at runtime from the native Firebase app (src/lib/crash.ts firebaseReady()).
      firebase: { ios, android },
    },
  };
};
