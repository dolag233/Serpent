# Setup

## Requirements

- Node.js **24.15.0** (locked in `.nvmrc`; use `nvm use`)
- npm
- Native development targets: macOS arm64, Windows x64
- **Do not build or run from an SMB/NAS-mounted path** — Electron fails to start on mounted volumes (`icudtl.dat not found`) and packaged apps cannot run from them either

### macOS

- Xcode Command Line Tools (for native module builds)
- Media component builds (only when rebuilding): `scripts/media-build/darwin-arm64.sh` (vcpkg, takes hours)

### Windows

- Git, PowerShell
- Visual Studio Build Tools: "Desktop development with C++" workload + Windows SDK
- Media component builds: `scripts/media-build/win32-x64.ps1`

## First build

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native
npm start
```

`rebuild:native` compiles `better-sqlite3` for Electron's ABI and verifies FTS5. On Windows, **do not** run a bare `@electron/rebuild` or `node-gyp` — machine-wide vcpkg MSBuild integration can link against a non-FTS5 sqlite3.dll; the project script disables it.

## Media components

`npm ci` does **not** install FFmpeg/ffprobe/OpenImageIO. Without them, normal development and image import still work; video thumbnails/proxies fail with `FFMPEG_REQUIRED`, and EXR/TGA/complex TIFF need OpenImageIO.

Packaged builds use the controlled media bundle (FFmpeg 8.1 LGPL-only + OpenImageIO 3.1.12.0); gates verify provenance and hashes (`bundle-lock.json` promotion status + `source-lock.json` version match). For local development you can point at any trusted FFmpeg via `SERPENT_FFMPEG_PATH` (needs the required filters/encoders; `ffprobe` in the same directory; GPL builds are local-dev only):

```bash
# macOS
export SERPENT_FFMPEG_PATH="$HOME/tools/ffmpeg/ffmpeg"
npm start
```

```powershell
# Windows
$env:SERPENT_FFMPEG_PATH = 'C:\tools\ffmpeg\ffmpeg.exe'
npm start
```

Quit Serpent completely before retrying (single-instance lock; a second `npm start` does not replace a running process).

## Common commands

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # unit + worker integration (runs in Electron)
npm run test:unit        # unit only
npm run test:worker      # worker integration only
npm run test:e2e         # Playwright E2E
npm start                # development launch
npm run start:multi      # two instances
```

## Notes

- Tests run under Electron's ABI (`test:worker`/`test` go through `run-vitest-with-electron.mjs`); after `npm run package`, run `npm run rebuild:native` to restore the dev native module
- `npm start` auto-avoids occupied Vite ports
