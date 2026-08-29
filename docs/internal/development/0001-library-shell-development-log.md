# Slice 0001 development log: library shell

> Status: QA complete on macOS; Windows pending
> Started: 2026-07-12
> Last updated: 2026-07-12

## References

- Spec: `docs/internal/implementation/0001-library-shell-vertical-slice.md`
- Process: `docs/internal/development-process.md`
- Branch: `codex/slice-001-library-shell`
- Base SHA: `a371ac2aca622e52eddb57b69af76ea844c016de`
- Slice commit: `ae1fcf4b5646c46a7334024032c99dfb8549b576` (`feat: establish secure library shell`)

## Confirmed test seams

- Library Worker public commands and results.
- Renderer-to-Preload IPC contract.
- Electron create/open-library user flow.

## Progress

- Product and domain interview completed for the MVP boundary.
- Eagle UI screenshot established as the first-shell visual reference.
- Development, review, and QA documentation made part of the definition of done.
- Created the Git root baseline and switched development to `codex/slice-001-library-shell`.
- Completed parallel architecture, UI-reference, and QA analysis.
- Implemented strict Renderer/Main/Worker protocols, lifecycle events, sandboxed Preload API, single-instance Main lifecycle and UtilityProcess request correlation.
- Implemented atomic library creation, SQLite v1 migration/audit, structure and corruption validation, idempotent open, moved-library reopen and graceful close.
- Implemented the Eagle-referenced `Studio Contact Sheet` three-pane shell with packaged CJK and mono typography.
- Added unit, Worker, process-lifecycle, production-bundle and packaged-app Electron tests.
- Completed macOS arm64 packaging, native dependency verification and APFS-staged visual QA.

## Decisions

- The first slice excludes import, media, AI, search, and collection behavior.
- UI quality is a release gate for the target audience; the shell must establish a deliberate professional visual system rather than a disposable scaffold.
- Visual direction is `Studio Contact Sheet`: a dense three-pane graphite workspace with restrained teal focus/selection and packaged CJK/mono typography. See `docs/internal/ui/0001-studio-contact-sheet-direction.md`.
- Scaffold direction is Electron Forge + Vite + React + TypeScript, with Zod-validated Renderer/Main/Worker contracts and better-sqlite3 externalized for native packaging.
- Vitest covers protocol, rules and Node-ABI Worker integration. Electron tests run after Forge produces the Electron-ABI native module and stage that production bundle on local APFS.
- Schema version authority is SQLite `PRAGMA user_version`; migration rows are audit history rather than a second authority.
- Library names use a documented Windows/macOS-safe Unicode subset. Partial creates use an unmistakable `.serpent-create-<uuid>.partial` directory.
- Duplicate open is idempotent. On macOS, closing the final window keeps the app/Worker alive; explicit Quit releases the Worker and database.
- Local workflow assets and `docs/` remain outside Git according to the product decision; source code and project configuration are committed.
- The first valid schema is v1. There is no released v0 library to upgrade; `user_version = 0` is rejected rather than guessed into a library identity. A general upgrade path becomes actionable with v2.

## Verification log

- Local environment: macOS arm64, Node 24.15.0, npm 11.12.1.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test:unit`: 28/28 passed.
- `npm run test:worker`: 13/13 passed.
- `npm run package`: passed for macOS arm64.
- `npm run verify:package`: passed; ASAR and unpacked `better_sqlite3.node` present.
- `npm audit --omit=dev --registry=https://registry.npmjs.org`: passed, 0 production vulnerabilities.
- Electron ABI probe: packaged `better-sqlite3` loaded under ABI 148 and created a database.
- `npm run test:e2e`: 4/4 passed using the production bundle staged on APFS.
- `npm run test:e2e:packaged`: 1/1 passed against the copied real `.app`.
- Visual evidence: `test-results/.../library-ready.png` and `test-results/.../packaged-empty-state.png`.

## Failures and resolutions

- Initial `npm install` failed with `ERESOLVE`: `typescript-eslint@8.63.0` declares TypeScript support `<6.1.0`, while the first scaffold pinned TypeScript 7.0.2. The install was not forced; TypeScript was pinned to 6.0.3, the newest compatible 6.x release, pending future ecosystem support for TypeScript 7.
- The first install attempt used a locally configured slow npm mirror and was interrupted after individual packages took several minutes. A retry against the official registry completed and produced the lockfile; transient partial native files required verification before tests.
- Initial typecheck showed Forge Vite build targets accept only `main` or `preload`. The UtilityProcess build now uses a second `main`-target configuration with an explicit `library_worker.js` output; Main and Preload also have explicit stable output names.
- Forge's current dependency declarations contain upstream type gaps under TypeScript 6 (`NewCtx`, missing transitive declaration modules). `skipLibCheck` isolates dependency declarations while all Serpent source remains under strict checking.
- `npm audit --omit=dev` could not reach the official advisory endpoint due a TLS disconnect; audit remains pending and is not treated as passed.
- An interrupted install corrupted Rolldown's native binary. A lockfile-only refresh followed by clean `npm ci` restored 693 packages; the NAS needed about 15 minutes for small-file writes.
- Vite initially resolved Renderer `index.html` from the wrong root. The final structure uses the Forge-standard repository-root `index.html` and `.vite/renderer` output.
- `createRequire(import.meta.url)` became `createRequire(undefined)` in the CJS Worker bundle. Replacing it with a normal external CommonJS import fixed the ready-handshake crash.
- Forge Vite's default ignore function omitted external native modules. The custom Packager ignore retains `.vite` and `node_modules`, after which pruning and Auto Unpack produce an Electron ABI 148 native module in `app.asar.unpacked`.
- macOS cannot reliably execute an Electron `.app` directly from the SMB-mounted workspace; code-sign/resource lookup failed despite files existing. Production bundles and the real packaged app were copied to local APFS for execution QA.
- Playwright cannot gracefully close an Electron application after its final macOS window is deliberately closed. The test asserts zero windows plus a live process, then kills only the test child; graceful Quit is independently covered by the restart/reopen test.

## Deviations

- Clarification: because v1 is the first valid library schema, there is no legitimate older database to migrate on open. The implementation rejects `user_version = 0`; sequential upgrade code is deferred until a v2 migration exists rather than inventing an undocumented v0 format.

## Known risks and next work

- Windows packaged QA requires a Windows machine or CI runner; without one the slice can only receive a conditional QA pass.
- Native SQLite packaging must be validated against the chosen Electron toolchain before the library lifecycle is considered complete.
- Native SQLite packaging is validated on macOS arm64; Windows ABI/package behavior remains unverified until a Windows runner is available.
- The full install still reports advisories in development-only tooling; the production dependency audit reports 0 vulnerabilities. Development-tool advisories remain an ecosystem maintenance item.
