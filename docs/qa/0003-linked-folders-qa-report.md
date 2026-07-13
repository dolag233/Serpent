# Slice 0003 QA report: linked folders

> Status: automated verification complete; manual/platform QA pending
> Date: 2026-07-13

## Build under test

- Branch: `codex/slice-002-asset-ingestion`
- Original fixed range: `8dc2470...cdc2247`
- Working-tree re-test: uncommitted shared tree on macOS arm64, Node 24.15.0 / Electron 43.1.0.
- Final shared-tree package/ASAR/native verification and packaged startup E2E were executed on macOS arm64.

## Automated evidence

| Gate | Result |
| --- | --- |
| Original repository E2E report at `cdc2247` | 8/8 passed overall, including linked-folder user flow; reconstructed from commit/test record, not rerun here |
| `linked-folders.test.ts` + `library-watcher.test.ts` | **16/16 passed** |
| `npm run lint` | passed |
| `npm run typecheck` | passed |
| Full `npm test` | **547/547 passed** |
| Full Electron E2E | **10/10 passed** |
| `npm run package` + `npm run verify:package` | passed |
| Packaged startup/import E2E | **1/1 passed** |

## Acceptance matrix

| Scenario | Automated result | Manual result |
| --- | --- | --- |
| v3→v4 migration preserves revisions/FKs | passed | not executed |
| Linked import, ignore rules and no source-byte copy | passed | not executed |
| Nested symlink is not followed/registered | passed (implemented as skip) | spec deviation pending decision |
| External overwrite creates revision; root loss becomes offline/missing | passed | not executed |
| Relink restores existing paths with stable asset IDs | passed | not executed |
| Managed and linked watchers debounce into stat reconciliation | passed | not executed |
| Renderer hides absolute paths | protocol/E2E evidence in original range | not manually inspected this pass |
| Persisted safe error/log pairing | diagnostic hooks covered; log path is `app.getPath('logs')/serpent.log` | not executed |

## Platform/manual QA

- macOS arm64 UI: **not executed in this pass**. No screenshots or manual checklist evidence.
- Packaged macOS startup and real Worker import: passed; linked-folder flow was not repeated against the packaged artifact.
- Windows: **not executed; no runner**. Case-insensitive identity, volume replacement, watcher and relink behavior remain risks.

## Final result

Automatic slice-specific verification passed and the slice may remain in code review. Overall QA is **not complete** and this is **not acceptance**.
