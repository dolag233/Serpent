# Testing

## Layers

| Layer | Directory | Environment | Command |
| --- | --- | --- | --- |
| Unit | `tests/unit/` | Node ABI | `npm run test:unit` |
| Worker integration | `tests/worker/` | Electron ABI | `npm run test:worker` |
| E2E | `tests/e2e/` | Playwright + Electron | `npm run test:e2e` |
| Packaged E2E | `tests/e2e/packaged-startup.test.ts` | packaged build | `npm run test:e2e:packaged` (requires package first) |

Full suite: `npm run test` (unit + worker, runs inside Electron; excludes performance tests).

## Common

```bash
npm run test                 # full (unit + worker)
npm run test:worker -- tests/worker/<file>   # single worker test file
npm run test:e2e             # Playwright E2E (dev mode)
npm run release:e2e:packaged # packaged startup tests (release pipeline e2e phase)
npm run verify:mainline      # release gate combo (test + perf + e2e)
```

## Conventions

- **Data-compatibility tests** (`tests/worker/schema-*`): lenient reads (missing/extra/renamed columns), migration atomicity, failure injection, upgrade/downgrade chains, migration-discipline static gate — keep them green when touching `MIGRATIONS` or read paths
- **Packaging gates**: `prepackage`/`premake` verify media and ufbx; `verify:package` verifies the output
- **E2E isolation**: packaged E2E uses a temp `SERPENT_E2E_USER_DATA_PATH` and never touches real config; dialogs are mocked (match the bilingual titles)
- **Test environment**: `SERPENT_E2E=1` enables isolation mode (isolated userData, E2E dialog paths, …)

## Writing tests

- Pure logic (no Electron/DB) goes in `tests/unit/`; Worker/DB code in `tests/worker/`; full journeys in `tests/e2e/`
- Worker tests use vitest (inside Electron); create libraries with `LibraryService.createLibrary` + a temp directory
- Long-running/performance tests go in `tests/worker/search-performance.test.ts` (excluded from the full `test` run)
