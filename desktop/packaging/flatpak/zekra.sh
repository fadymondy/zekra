#!/bin/sh
# Flatpak launcher: zypak lets Chromium's sandbox run inside the Flatpak one;
# CHROME_DESKTOP makes the Wayland app_id match the exported .desktop file.
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
export CHROME_DESKTOP=dev.zekra.Zekra.desktop
exec zypak-wrapper /app/zekra/zekra-desktop --ozone-platform-hint=auto "$@"
