# Build & Packaging

## Basic commands

```bash
npm run package          # package the app (includes build) → out/Serpent-<platform>-<arch>/
npm run make             # build installers → out/make/ (dmg / squirrel / zip)
npm run verify:package   # verify the packaged output (ASAR, native modules, media)
```

`package`/`make` run mandatory pre-hooks:

- Media binaries (`media-binaries verify` — provenance and hashes)
- ufbx WASM (`verify-ufbx-wasm` — hash-locked via `scripts/ufbx-wasm-lock.json`)
- Packaged output (`verify:package`: ASAR, better_sqlite3.node, Host utilities)

`package`/`make` update the dev Electron binary — run `npm run rebuild:native` afterwards.

## Release pipeline (release:local)

One command for the full flow:

```bash
npm run release:local
```

Phases: `verify` → `media` → `package` → `e2e` → `make` → `checksums`

| Phase | What it does |
| --- | --- |
| verify | `rebuild:native` + `verify:mainline` (same gates as CI) |
| media | download the controlled media bundle (`media:acquire`) + verify |
| package | `electron-forge package` + `verify:package` |
| e2e | packaged startup tests (`test:e2e:packaged`) |
| make | build installers |
| checksums | SHA-256 manifests (versioned header) |

Skip slow phases with `--skip-verify` / `--skip-media` / `--skip-e2e`. Run one phase with `npm run release:<phase>` (the e2e phase is `npm run release:e2e:packaged`).

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

`forge.config.ts` enforces **native-platform builds** (allowlist `darwin-arm64` / `win32-x64`) — media binaries, ufbx and native modules are platform-specific; cross-packaging is not supported. Windows runs the same pipeline on a Windows host.

## Browser extension

The extension ships inside the app bundle (`Resources/extension`), not via a store:

```bash
npm run extension:build   # builds dist/extension
```

`prePackage` rebuilds it automatically. Manual loading instructions are in the [user guide](../user-guide/installation.en.md).

## Signing

- **macOS**: currently ad-hoc signed (`osxSign.identity: '-'` — required on Apple Silicon; does not clear the Gatekeeper warning). Swap the identity for a Developer ID and add `osxNotarize` once you have a certificate
- **Windows**: currently unsigned (SmartScreen warning). For formal releases, SignPath free signing (same as VSCodium) or a commercial certificate

## Release prerequisites (in progress)

1. **Media promotion**: toolchain repo (Release attachments + `versions.json`) to remove the `SKIP_PROVENANCE` need
2. **Windows native validation**: same pipeline on a Windows host + install/uninstall journey
3. **Signing upgrade**: SignPath application / Apple Developer account
4. **CI/CD**: GitHub Actions tag-driven + platform matrix + draft → release

See the [research doc](../research/2026-08-08-local-release-packaging.md) for details.
