// Keeps the app's push entitlement as plugins/with-firebase.js decides it.
//
// expo-widgets (plugin/build/ios/withPushNotifications.js) always writes
// `aps-environment = development` into the APP's entitlements — even with
// `enablePushNotifications: false`, which only affects Live Activity pushes.
// Because it is registered before with-firebase (app.config.js appends that
// one), its entitlements mod runs after it and would turn a production build's
// APNs environment into development.
//
// Registered in app.json immediately BEFORE "expo-widgets", this mod runs
// right after expo-widgets' one and restores with-firebase's rule: production
// unless APS_ENVIRONMENT=development, and no push entitlement at all in a build
// without the iOS Firebase config (as before the widgets were added).
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withApsEnvironment(config) {
  return withEntitlementsPlist(config, (c) => {
    if (c.ios?.googleServicesFile) {
      c.modResults["aps-environment"] = process.env.APS_ENVIRONMENT === "development" ? "development" : "production";
    } else {
      delete c.modResults["aps-environment"];
    }
    return c;
  });
};
