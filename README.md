# Serpent

Serpent is an open-source, cross-platform digital asset manager for game artists, film and post-production teams, and designers.

The current foundation provides a secure Electron shell and a portable local-library lifecycle. Asset ingestion and browsing are the next active vertical slice.

## Development environment

Serpent's supported native development targets are macOS arm64 and Windows
x64. Keep the checkout and all generated directories (`node_modules`, `.vite`,
`out`, and test results) on a local APFS/NTFS disk. Do not run Electron from an
SMB/NAS-mounted path.

### Common setup

Install Node.js **24.15.0** (the version in `.nvmrc`) and npm, then run:

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native
npm start
```

`npm run rebuild:native` aligns `better-sqlite3` with Electron's ABI and checks
SQLite FTS5. On Windows, use this project command instead of a bare
`@electron/rebuild` invocation: it disables machine-wide vcpkg MSBuild
injection that can otherwise link the wrong SQLite DLL. After `npm run package`
or `npm run make`, rebuild the native module before running development tests.

### Platform prerequisites

- **macOS arm64:** use a native arm64 checkout. Install Xcode Command Line
  Tools for native builds. The controlled media bundle is built with
  `scripts/media-build/darwin-arm64.sh`.
- **Windows x64:** use a native x64 checkout. Install Git, PowerShell, and
  Visual Studio Build Tools with the Desktop development with C++ workload and
  Windows SDK. The controlled media bundle is built with
  `scripts/media-build/win32-x64.ps1`.

### FFmpeg and other media components

`npm ci` does **not** install FFmpeg, ffprobe, or OpenImageIO. Without these
external components, normal UI development and image import still work, but
video thumbnail/poster generation fails with `FFMPEG_REQUIRED`; EXR/TGA and
complex TIFF processing also requires OpenImageIO.

The supported controlled bundle is not compatible with an arbitrary FFmpeg
version:

- FFmpeg and ffprobe: **8.1** (`n8.1`), built as LGPL-only executables;
  ffprobe must come from the same bundle.
- Required FFmpeg capabilities include `thumbnail`, `fps`, `scale`, `tile`,
  `drawtext`, `libvpx-vp9`, and `libopus`.
- GPL/nonfree builds and `libx264`, `libx265`, or `libfdk-aac` are rejected.
- OpenImageIO: **3.1.12.0** with the controlled OpenColorIO configuration.

For local development only, another FFmpeg version may work if it provides all
of the required filters and encoders above. A build that reports
`--enable-gpl` is a **GPL build**, not an LGPL build: it may be used only as a
local development override after a capability smoke test and must never be
copied into `resources/` or included in a package. Packaged Serpent releases
must use the project-controlled **FFmpeg 8.1 LGPL-only** bundle with its
matching ffprobe, manifest, license files, and provenance receipt.

For local, non-release testing, point Serpent at a trusted FFmpeg build whose
`ffmpeg` and `ffprobe` are in the same directory:

```powershell
# Windows PowerShell
$env:SERPENT_FFMPEG_PATH = 'C:\tools\ffmpeg\ffmpeg.exe'
# Set this before launching Serpent, in the same terminal.
npm start
```

```bash
# macOS
export SERPENT_FFMPEG_PATH="$HOME/tools/ffmpeg/ffmpeg"
# Set this before launching Serpent, in the same terminal.
npm start
```

Fully quit any existing Serpent process before retrying: the desktop app uses a
single-instance lock, so a second `npm start` does not replace a process that
was launched without the override. After the component becomes available,
fully restarting Serpent and reopening the library automatically requeues
previous `FFMPEG_REQUIRED`/`OIIO_REQUIRED` preview failures; other failures may
still require the asset's explicit retry action.

The override is only a development escape hatch; an unverified system
installation is not a release bundle. For the reproducible bundle workflow,
run the native platform build above. Once an immutable URL and checksums have
been promoted in `resources/media-binaries/bundle-lock.json`, acquire and
verify the bundle with:

```bash
npm run media:acquire -- --platform darwin-arm64  # macOS arm64
npm run media:acquire -- --platform win32-x64     # Windows x64
npm run media:verify -- --platform <platform>
```

The repository may intentionally report `build-required` until a platform
bundle is promoted. See `resources/media-binaries/README.md` for the complete
build, licensing, provenance, and packaging requirements.

Quality gates:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:worker
npm run package
npm run verify:package
```

Electron lifecycle tests use a production bundle and platform-local staging paths. See `docs/development-process.md` and the current QA report in workspaces that include the separately managed `docs/` directory.

## Developer documentation

User-facing manuals for plugin, automation script, Script API, and MCP authors are collected in [`docs/manual/`](docs/manual/README.md). These pages describe the current entry points and explicitly mark platform or packaged flows that are not yet verified.

## Third-party assets

- 3D 预览内置 HDRI 环境贴图（ferndale_studio_03 / dancing_hall / pergola_walkway /
  scythian_tombs_2，1K RGBE）与预览缩略图来自 [Poly Haven](https://polyhaven.com)
  （CC0 公共领域，可商用无需署名，随产品分发保留此致谢）。

## License

MIT
