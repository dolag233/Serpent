# Serpent

Open-source (MIT), cross-platform (macOS / Windows) digital asset manager for game artists, film and post-production teams, and designers.

Import, browse, search, tag, collect, preview 3D models (FBX/OBJ/GLB and more), and render with HDRI environment lighting and PBR. Data stays in a local library — no cloud dependency.

- Chinese version: [README.md](README.md)
- User guide: [docs/user-guide/README.en.md](docs/user-guide/README.en.md)
- Developer docs: [docs/developer/README.en.md](docs/developer/README.en.md)

## Install

Formal releases have not started yet (no installers on GitHub Releases at this time). Build installers locally with `npm run make`, or ask the maintainers.

**macOS**: download `Serpent-<version>-arm64.dmg` and drag it into Applications. On first launch macOS shows "cannot verify the developer" — right-click the app → Open (first time only), or run:

```bash
xattr -cr /Applications/Serpent.app
```

**Windows**: run `Serpent-<version> Setup.exe`. Unsigned builds show a SmartScreen warning on first run — choose "More info → Run anyway".

**Browser extension**: ships inside the app (not via a store). Open `chrome://extensions`, enable Developer mode, and load the unpacked extension:

- macOS: `Serpent.app/Contents/Resources/extension`
- Windows: `resources/extension` in the install directory

## Build locally

Requires Node.js 24.15.0 (see `.nvmrc`). Native development targets are macOS arm64 and Windows x64. Do not build from an SMB/NAS-mounted path.

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native   # align better-sqlite3 with Electron's ABI (verifies FTS5)
npm start
```

Common commands:

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # unit + worker integration tests
npm run test:e2e         # Playwright E2E
npm run package          # package to out/Serpent-<platform>-<arch>/
npm run make             # build platform installers (macOS dmg / Windows zip; Windows setup via Inno Setup)
```

The full build, packaging and release flow is in the [developer docs](docs/developer/build-packaging.en.md).

## Documentation

| Doc | Content |
| --- | --- |
| [User guide](docs/user-guide/README.en.md) | Install, import, browse, search, tags, collections, 3D viewer, troubleshooting |
| [Developer docs](docs/developer/README.en.md) | Setup, build & packaging, architecture, testing |
| [Extension author manual](docs/manual/README.md) | Plugins / scripts / MCP |
| [Product brief](docs/product-brief.md) | Product vision and MVP scope |

## License

MIT. Bundled media components and assets carry their own licenses (FFmpeg LGPL, OpenImageIO, ufbx MIT, Poly Haven CC0) — see the LICENSE files under each `resources/` directory.
