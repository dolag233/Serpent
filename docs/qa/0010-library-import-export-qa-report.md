# Slice 0010 QA report: library import/export

> Status: fixing / QA incomplete
> Date: 2026-07-13

## Build under test

- Original fixed range: `8dc2470...cdc2247`
- Working-tree re-test: uncommitted shared tree on macOS arm64, Node 24.15.0 / Electron 43.1.0.
- Packaged startup/import was tested on macOS arm64; no Windows device or large production library was used.

## Automated evidence

| Gate | Result |
| --- | --- |
| Folder export/import + ZIP Worker tests | **45/45 passed** |
| Live cancellation | folder export/import and ZIP export/import announce an operation ID before completion and clean only owned partial output |
| Global lint/typecheck | passed |
| Full `npm test` | 2026-07-13 current-tree checkpoint: **713 passed / 1 skipped**; final count pending later cross-slice merge |
| Full Electron E2E | Earlier checkpoint passed; must be rerun after current cross-slice work |
| Package/verify + packaged startup/import | Earlier package checkpoint is superseded by the promoted media-bundle gate; current release package is blocked until immutable bundle publication/receipt |

## Acceptance/security matrix

| Scenario | Result |
| --- | --- |
| Folder snapshot/export/import round trip | automated pass |
| ZIP round trip and standard-ZIP preflight | automated pass |
| Destination-inside-library / existing-output ownership | automated pass |
| Path traversal, absolute/drive names and ambiguous segments | automated pass |
| ZIP symlink rejection | automated pass |
| Entry/total expansion and compression-bomb limits | automated pass |
| Streaming extraction without whole-ZIP Buffer | automated pass with real multi-chunk entry and progress |
| SQLite Online Backup snapshot + integrity verification | automated pass |
| Include linked content in folder and ZIP without same-name collision | automated pass |
| Failure cleanup does not remove caller-owned input/output | automated pass |
| Cancel a running export from Renderer and remove partial target | automated pass for folder and ZIP paths |
| Cancel a running import from Renderer and remove partial target | automated pass for folder and ZIP paths |

## Platform/manual QA

- macOS UI progress, cancel button and summary: not executed.
- Large real library with revisions/trash/linked content: not executed.
- Packaged app startup/import passed; packaged export/import UI was not manually executed.
- Windows↔macOS ZIP/folder portability and non-ASCII/long paths: not executed; no Windows runner.
- Safe UI reason + persisted log for corrupt/hostile archive: not manually verified.

## Final result

**Automated gates passed; manual/platform QA remains.** Archive hardening and live cancellation are now covered without todo tests. Large-library soak, packaged transfer UI, cross-platform portability and Windows behavior remain unverified, so this is not final acceptance.
