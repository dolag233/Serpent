# Build & Packaging

## Basic commands

```bash
npm run package          # package the app (includes build) → out/Serpent-<platform>-<arch>/
npm run make             # build installers → out/make/ (macOS dmg / Windows zip; Windows setup built with Inno Setup)
npm run verify:package   # verify the packaged output (ASAR, native modules, media)
```

`package`/`make` run pre-hooks that ensure the media dependencies are available:

- Media binaries (`media-binaries ensure` — recover from the pinned release when needed, then verify provenance and hashes)
- ufbx WASM (`verify-ufbx-wasm` — hash-locked via `scripts/ufbx-wasm-lock.json`)
- Packaged output (`verify:package`: ASAR, better_sqlite3.node, Host utilities)

`package`/`make` update the dev Electron binary — run `npm run rebuild:native` afterwards.

If the media executables are missing or do not match the promoted manifest, the
hook automatically downloads and verifies the pinned `Serpent-Build` release.
Run the same recovery explicitly with:

```bash
npm run media:ensure
```

Set `SERPENT_MEDIA_AUTO_ACQUIRE=0` in an offline environment to make a failed
verification stop immediately instead of downloading.

## Release pipeline (release:local)

One command for the full flow:

```bash
npm run release:local
```

Phases: `verify` → `media` → `package` → `e2e` → `make` → `checksums`

| Phase | What it does |
| --- | --- |
| verify | `rebuild:native` + `verify:mainline` (same gates as CI) |
| media | download the controlled media bundle (`media:acquire`) + verify; linux-x64 and linux-arm64 use the same gate as macOS/Windows (linux-arm64 stays `build-required` until its bundle is promoted) |
| package | `electron-forge package` + `verify:package` |
| e2e | packaged startup tests (`test:e2e:packaged`) |
| make | build installers (Linux: prefer `make:appimage:docker`, rename to `Serpent-linux-x86-64-<ver>.AppImage` or `Serpent-linux-arm64-<ver>.AppImage`) |
| checksums | SHA-256 manifests (versioned header) |

Skip slow phases with `--skip-verify` / `--skip-media` / `--skip-e2e`. Run one phase with `npm run release:<phase>` (the e2e phase is `npm run release:e2e:packaged`).

```mermaid
flowchart LR
    C[Change] --> L[Lint + typecheck]
    L --> U[Unit tests]
    U --> W[Worker integration]
    W --> E[Electron E2E]
    E --> P[Package + verify]
    P --> PE[Packaged E2E]
    PE --> R[Make release artifacts]
```

### Local trial without media promotion

The media bundle must be "promoted" (built and registered in `bundle-lock.json` with an immutable URL + hashes) before the formal pipeline runs. If local artifacts already match `source-lock.json`, you can skip provenance:

```bash
SERPENT_MEDIA_SKIP_PROVENANCE=1 npm run release:local -- --skip-verify --skip-media
```

> `SKIP_PROVENANCE` is for local trials only. Formal releases must go through promotion.

Another local path is `--build-media-locally`: build the full media bundle on this machine with vcpkg (`scripts/media-build/*`, takes 1-3 hours) and let the gates use the local artifacts:

```bash
npm run release:local -- --skip-verify --build-media-locally
```

### Versions

- Version lives in `package.json` (semver)
- Bump with `npm version patch|minor|major` (tags automatically)
- Every pipeline run prints `Serpent v<version>`; checksum manifests carry the version header

### Platforms

`forge.config.ts` enforces **native-platform builds** — the pinned-media allowlist is `darwin-arm64` / `win32-x64` / `linux-x64` / `linux-arm64`; Linux must also be packaged on a Linux host (or inside a same-architecture `make:appimage:docker`). Cross-packaging is not supported. Each platform runs the same release pipeline locally.

### Linux AppImage

```bash
npm run make:appimage           # host → out/make/appimage/Serpent-<ver>-x86_64.AppImage or Serpent-<ver>-aarch64.AppImage
npm run make:appimage:docker    # Ubuntu 22.04 / glibc 2.35 baseline; container arch follows the host (preferred for release)
npm run release:make            # prefers docker and renames to Serpent-linux-x86-64-<ver>.AppImage or Serpent-linux-arm64-<ver>.AppImage
```

- linux-x64 and linux-arm64 ship the same pinned media bundle contract as macOS/Windows (`ffmpeg` / `ffprobe` / `oiiotool`). `package` runs `media:ensure` in `prePackage`. linux-x64 is `ready` in `bundle-lock.json`. linux-arm64 is still `build-required`: `media-v0.1.2` has no `serpent-media-linux-arm64.zip`. Until `scripts/media-build/linux-arm64.sh` runs on native aarch64 and the URL plus SHA-256 are written back, `media:acquire` fails closed and a release AppImage cannot be produced. Local trials can set `SERPENT_MEDIA_SKIP_PROVENANCE=1` or pass `--build-media-locally`.
- Build Linux media bundles inside an `ubuntu:22.04` container with `scripts/media-build/linux-*.sh` (stock GCC) so `ffmpeg`/`ffprobe`/`oiiotool` need at most GLIBC 2.35, matching the AppImage's 22.04 baseline. Check with `objdump -T <bin> | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1` before publishing. linux-x64 is currently `media-v0.1.3` (22.04 rebuild, same sources/config as `media-v0.1.2`).
- The glibc baseline matches x86_64 (Ubuntu 22.04 / 2.35). Needs FUSE (`libfuse2`); without FUSE use `--appimage-extract-and-run`. X11 / Wayland limits match x86_64.
- Release upload names match the in-app updater: `Serpent-linux-x86-64-<ver>.AppImage` or `Serpent-linux-arm64-<ver>.AppImage` (plus a sibling `.sha256`). Checksum manifests are `SHA256SUMS-linux-x64.txt` / `SHA256SUMS-linux-arm64.txt`.

### Windows installer (Inno Setup)

The Windows installer `SerpentSetup.exe` is built with **Inno Setup 6** (script `assets/inno/serpentsetup.iss`, outputting to `out/make/inno/SerpentSetup.exe`):

#### 1. Install Inno Setup compiler dependency (ISCC.exe)

Running `npm run make:inno` requires `ISCC.exe`, which can be prepared in one of two ways:

- **No admin rights required (recommended)**:
  Download `Tools.InnoSetup` from NuGet, extract it, and place the directory containing `ISCC.exe` in `%LOCALAPPDATA%\SerpentTools\inno\tools` (the build script looks here by default).
- **Official installer**:
  Install official Inno Setup 6 and set environment variable `SERPENT_INNO_TOOLS` to the absolute path containing `ISCC.exe` (e.g., `C:\Program Files (x86)\Inno Setup 6`), or add that folder to system `PATH`.

#### 2. Build commands

```bash
# 1. Package the application first (generates out/Serpent-win32-x64)
npm run package

# 2. Run the Inno installer build script
npm run make:inno
```

- Multilingual: language selection dialog on launch (defaults to system language), English + Simplified Chinese
- Wizard with install-path selection (default `C:\Program Files\Serpent`), Start Menu / desktop shortcuts
- Per-machine install (UAC elevation), automatic uninstaller `unins000.exe` and Apps & Features entry

> History: Squirrel (no wizard / no path selection / uninstall leftovers) and WiX MSI (MSI language switching requires a custom bootstrapper, confirmed by the community) were both tried and rolled back — see the [Windows packaging development log](https://github.com/dolag233/Serpent/blob/dolag_dev/docs/internal/development/2026-08-08-windows-packaging-and-squirrel-installer-development-log.md).

## Media binary promotion (Serpent-Build)

Media bundles (FFmpeg/OpenImageIO) are distributed via GitHub Releases on the
[Serpent-Build](https://github.com/dolag233/Serpent-Build) repo (immutable URL +
SHA-256); main-repo `release:media` downloads and verifies them:

1. **Build once** (not in CI):
   - `ffmpeg/ffprobe`: BtbN LGPL builds (`registry.npmmirror.com/-/binary/ffmpeg-builds/`
     `ffmpeg-<ver>-win32-x64-lgpl.tar.xz`, or the macOS variant), LGPL-only (no GPL markers)
   - `oiiotool`: `scripts/media-build/build-oiiotool-win32.ps1` (Windows) /
     `darwin-arm64.sh` (macOS) / `linux-x64.sh` (Linux x86_64) / `linux-arm64.sh` (Linux aarch64, together with FFmpeg)
     — vcpkg build (pinned toolchain + registry commit)
2. **Package and upload**:
   ```bash
   # assemble zip (platform layer ffmpeg/<platform>/…) + sha256
   # upload (create/reuse Release media-v<ver> + assets + publish):
   node scripts/release/publish-media-bundle.mjs --platform win32-x64 \
     --version v0.1.1 --zip artifacts/media-binaries/serpent-media-win32-x64.zip
   ```
3. **Promote in main repo**: set the platform entry in
   `resources/media-binaries/bundle-lock.json` to
   `{status: ready, url, sha256, size, manifestSha256}` (script prints the entry).

> Versioning: bundle versions are independent of app versions (`media-vX.Y.Z`);
> Releases use GitHub Immutable Releases (assets immutable, tags non-reusable).

## Browser extension

The extension ships inside the app bundle (`Resources/extension`), not via a store:

```bash
npm run extension:build   # builds dist/extension
```

`prePackage` rebuilds it automatically. Manual loading instructions are in the [user guide](../user-guide/installation.md).

## Signing

- **macOS**: packages are ad-hoc signed (`identity: '-'` with keychain identity validation off; otherwise the lookup fails and is skipped, and Gatekeeper still reports the app as damaged). Ad-hoc signatures do not share a team identifier, so the entitlements must allow loading bundled frameworks; otherwise the system kills the app at launch. This does not clear the unidentified-developer prompt; the first launch needs right-click Open. Swap the identity for a Developer ID and add `osxNotarize` once you have a certificate
- **Windows**: currently unsigned (SmartScreen warning). For formal releases, SignPath free signing (same as VSCodium) or a commercial certificate

## Release prerequisites (in progress)

1. **Media promotion**: toolchain repo (Release attachments + `versions.json`) to remove the `SKIP_PROVENANCE` need
2. **Windows native validation**: same pipeline on a Windows host + install/uninstall journey
3. **Signing upgrade**: SignPath application / Apple Developer account
4. **CI/CD**: local CICD (2026-08-09 decision: main repo dropped GitHub Actions;
   each target platform runs `npm run release:local`; the browser-extension repo keeps
   Actions for release publishing). See [local CICD](https://github.com/dolag233/Serpent/blob/dolag_dev/docs/internal/development/local-cicd.md).

See the research doc for details.
