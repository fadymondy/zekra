// Keeps expo-dev-client's local-network prompt out of store builds.
//
// expo-dev-launcher adds NSLocalNetworkUsageDescription ("Expo Dev Launcher uses
// the local network…") and the _expo._tcp Bonjour service to Info.plist so a
// debug build can find Metro on the LAN. Its own build phase that strips them
// from Release builds did not run in the 1.0.0 archive, so the dev-only purpose
// string shipped (App Review 5.1.1: purpose strings must describe the app).
//
// Registered FIRST in app.json, so this Info.plist mod runs after every other
// one (expo-dev-client's included). It removes the keys unless the build is a
// local dev-client build: ZEKRA_DEV_CLIENT=1 (set by `npm run ios`) keeps them.
// Any other Bonjour service or a custom local-network text is left alone.
const { withInfoPlist } = require("expo/config-plugins");

const DEV_SERVICE = "_expo._tcp";

module.exports = function withStoreInfoPlist(config) {
  return withInfoPlist(config, (c) => {
    if (process.env.ZEKRA_DEV_CLIENT === "1") return c;
    const plist = c.modResults;
    if (Array.isArray(plist.NSBonjourServices)) {
      const kept = plist.NSBonjourServices.filter((s) => String(s).toLowerCase().replace(/\.$/, "") !== DEV_SERVICE);
      if (kept.length) plist.NSBonjourServices = kept;
      else delete plist.NSBonjourServices;
    }
    if (typeof plist.NSLocalNetworkUsageDescription === "string" && plist.NSLocalNetworkUsageDescription.includes("Expo Dev Launcher")) {
      delete plist.NSLocalNetworkUsageDescription;
    }
    return c;
  });
};
