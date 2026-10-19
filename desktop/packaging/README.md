# Linux store packaging

Both packages repackage the published `zekra-desktop_<v>_amd64.deb` from GitHub
Releases. They don't rebuild from source.

- `flatpak/`: Flathub manifest `dev.zekra.Zekra.yml` (Electron2 BaseApp 26.08), launcher,
  .desktop, AppStream metainfo, `flathub.json` (x86_64 only). For the Flathub submission,
  copy these files into the `flathub/flathub` PR (`new-pr` branch).
- `snap/`: `snapcraft.yaml` (core24, gnome extension, strict confinement) and `gui/` (.desktop and icon).

In both, the self-updater is disabled: the build deletes `resources/app-update.yml`, and
`updater.ts` also turns the updater off when `FLATPAK_ID` / `SNAP` is set.

Building on the Windows box (WSL Ubuntu 24.04). First check that C: has at least 30 GB free.
- flatpak-builder state and ostree need a real Linux filesystem, and `/mnt/e` (drvfs)
  isn't one. An ext4 image file on E: also fails: drvfs doesn't create it sparse, and
  `mkfs` hangs on it. So build in a scratch dir inside WSL (`/srv/zekra-build`) and
  delete it afterwards.
- Snap: `snapcraft pack --destructive-mode` (the host is 24.04, the same as core24), so no
  LXD and no LXD storage. snapcraft only writes the .snap inside the project dir, so copy it out.
- Smoke test under WSLg: set `XDG_SESSION_TYPE=wayland` and link `/mnt/wslg/runtime-dir/wayland-0`
  into `/run/user/<uid>`, or Electron falls back to X11 and exits. The GPU-process errors are expected (no GPU in WSL).
- Copy the finished `.flatpak` and `.snap` to E:. Afterwards run
  `rm -rf /srv/zekra-build ~/.cache/snapcraft` and `flatpak uninstall --user --unused`.

Still to do before submitting: add `screenshots/notes.png` (taken from dev.zekra.dev,
never live). The metainfo already points at it on `main`.
