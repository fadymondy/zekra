# Linux store packaging

Both packages repackage the published `zekra-desktop_<v>_amd64.deb` from GitHub
Releases. They don't rebuild from source.

- `flatpak/`: Flathub manifest `dev.zekra.Zekra.yml` (Electron2 BaseApp 24.08), launcher,
  .desktop, AppStream metainfo, `flathub.json` (x86_64 only). For the Flathub submission,
  copy these files into the `flathub/flathub` PR (`new-pr` branch).
- `snap/`: `snapcraft.yaml` (core24, gnome extension, strict confinement) and `gui/` (.desktop and icon).

In both, the self-updater is disabled: the build deletes `resources/app-update.yml`, and
`updater.ts` also turns the updater off when `FLATPAK_ID` / `SNAP` is set.

Disk: in WSL, keep build dirs, `--state-dir` and the LXD storage pool on E:
(`/mnt/e/tmp/zekra-pkg/...`), never in the C:-backed vhdx. Delete them after each build
(`rm -rf` the flatpak state/build dirs, `snapcraft clean`, `lxc image delete`).

Still to do before submitting: add `screenshots/notes.png` (taken from dev.zekra.dev,
never live). The metainfo already points at it on `main`.
