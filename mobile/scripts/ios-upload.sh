#!/usr/bin/env bash
# Archive the iOS app locally and upload it to App Store Connect (TestFlight).
#
# The CI path is codemagic.yaml → ios-release. This is the same build from a Mac
# with Xcode signed in to the Apple team JW9HJH86GC (engfadymondy@gmail.com):
# automatic signing, so Xcode creates/refreshes the distribution certificate and
# the App Store profile for com.fadymondy.zekra (-allowProvisioningUpdates).
#
# Usage (from anywhere):
#   mobile/scripts/ios-upload.sh <build-number> [--no-upload]
#
#   <build-number>  must be higher than every build already uploaded for this
#                   version (App Store Connect → TestFlight shows the last one).
#   --no-upload     archive + export an .ipa into mobile/build/ios-export only.
#
# Upload auth: the Apple ID signed in to Xcode (Settings → Accounts), or an App
# Store Connect API key when these are set:
#   ASC_KEY_PATH=/path/AuthKey_XXXX.p8  ASC_KEY_ID=XXXX  ASC_ISSUER_ID=uuid
#
# Firebase: put secrets/GoogleService-Info.plist in place first, or the build
# ships without push/Crashlytics/Analytics (it still runs; see app.config.js).
#
# WARNING: regenerates mobile/ios with `expo prebuild --clean`.
set -euo pipefail

TEAM_ID="${APPLE_TEAM_ID:-JW9HJH86GC}"
BUILD_NUMBER="${1:-}"
UPLOAD=1
[[ "${2:-}" == "--no-upload" ]] && UPLOAD=0

if ! [[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: $0 <build-number> [--no-upload]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
MOBILE="$(pwd)"
OUT="$MOBILE/build"
ARCHIVE="$OUT/Zekra.xcarchive"
EXPORT="$OUT/ios-export"

[[ -f secrets/GoogleService-Info.plist ]] || echo "warning: secrets/GoogleService-Info.plist missing — building WITHOUT Firebase" >&2

# Stamp the build number for this archive only; app.json is restored on exit so
# the committed file keeps its unstamped value.
mkdir -p "$OUT"
BACKUP="$(mktemp -t zekra-app-json)"
cp app.json "$BACKUP"
trap 'cp -f "$BACKUP" "$MOBILE/app.json"; rm -f "$BACKUP"' EXIT
node scripts/set-build-number.js "$BUILD_NUMBER"

export APPLE_TEAM_ID="$TEAM_ID"
CI=1 npx expo prebuild --platform ios --no-install --clean
(cd ios && pod install)

WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
echo "workspace: $WORKSPACE  scheme: $SCHEME  team: $TEAM_ID  build: $BUILD_NUMBER"

AUTH=()
if [[ -n "${ASC_KEY_PATH:-}" && -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

rm -rf "$ARCHIVE" "$EXPORT"
xcodebuild archive \
  -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic

# A copy, so the committed plist is never edited: team override, export-only.
OPTIONS="$OUT/ExportOptions.plist"
cp scripts/ios/ExportOptions.plist "$OPTIONS"
plutil -replace teamID -string "$TEAM_ID" "$OPTIONS"
[[ "$UPLOAD" == 0 ]] && plutil -replace destination -string export "$OPTIONS"

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" -exportPath "$EXPORT" -exportOptionsPlist "$OPTIONS" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

if [[ "$UPLOAD" == 1 ]]; then
  echo "Uploaded build $BUILD_NUMBER to App Store Connect; it appears in TestFlight after processing."
else
  echo "Exported to $EXPORT (not uploaded)."
fi
