// Mac App Store build config: electron-builder.yml plus the App Store app's
// identity (`npm run dist:mas`). Kept in JS because the CLI (-c.x=y) parses
// "1.0" as the number 1. electron-builder reads bundle(Short)Version from
// `mac`, not `mas`, so they're set there for this build only.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const base = yaml.load(fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8"));

module.exports = {
  ...base,
  appId: "com.fadymondy.zekra",
  directories: { ...base.directories, output: "dist-mas" },
  mac: {
    ...base.mac,
    // Must match the ASC macOS version record.
    bundleShortVersion: "1.0",
    // Grows with every upload: MAS_BUILD_NUMBER=2 npm run dist:mas
    bundleVersion: process.env.MAS_BUILD_NUMBER || "1",
  },
};
