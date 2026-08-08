# Slice 0010 QA report: library import/export

> Status: candidate fixed / QA incomplete; final merged verification pending
> Date: 2026-07-13 / calibrated 2026-07-16

## Build under test

- Original fixed range: `8dc2470...cdc2247`
- Candidate: `f1330a7` on macOS arm64, Node 24.15.0 / Electron 43.1.0.
- Packaged startup/import was tested on macOS arm64; no Windows device or large production library was used.
- Final merged mainline SHA and gate result remain pending.

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

Historical automated checkpoints passed; final merged gates, manual QA and platform QA remain. Archive hardening and live cancellation have targeted tests. The 20k folder/ZIP soak found no mismatch within its asserted exact and sampled fields; it does not prove complete row/file equivalence. Packaged transfer UI, cross-platform portability and Windows behavior remain unverified, so this is not final acceptance.

## Large-library soak test (2026-07-14)

A soak test was added at `tests/worker/library-import-export-soak.test.ts` to validate round-trip integrity at scale.

### Configuration

| Parameter | Value |
| --- | --- |
| Asset count | 20,000 |
| Rationale | 100k was the 0005 gate, but the soak requires writing real files to disk and copying them during export. 100k real files would exceed reasonable test timeout; 20k provides meaningful coverage of both DB and filesystem paths without timing out. |
| File extensions | png, jpg, psd, blend, tga (rotating) |
| Byte sizes | 100-793 bytes (4 tiers) |
| Modified dates | Spread across 365 days (2025-06-01 to 2026-06-01) |
| Labels | 70% of assets |
| Ratings | 0-5 (6 tiers) |
| Favorites | ~7.7% of assets (every 13th) |
| Descriptions | 4% of assets (every 25th) |
| Tags | 10 tags, assigned to ~10% of assets (every 10th) |
| Collections | 5 collections, assigned to ~5% of assets (every 20th) |
| Seeding method | Direct better-sqlite3 single-transaction batch INSERT + filesystem `writeFileSync`; candidate `f1330a7` then trashes 10 assets through `LibraryService.trashAssets` |

### Results

| Operation | Time | Threshold | Verdict |
| --- | --- | --- | --- |
| Folder export (20k assets) | ~3.6 s | < 60 s | PASS |
| Folder import (copy+open) | ~3.9 s | < 60 s | PASS |
| ZIP export (20k assets) | ~4.1 s | < 60 s | PASS |
| ZIP import (extract+open) | ~6.4 s | < 60 s | PASS |
| Round-trip asset count | 20,000 exact match | equality | PASS |
| Field spot-check (200 assets) | relativeFilePath, byteSize, locationKind all match | equality | PASS |
| Metadata spot-check (50 assets) | label, rating, favorite, description all match | equality | PASS |
| Tags preserved | 10/10 tag names match | equality | PASS |
| Collections preserved | 5/5 collection names match | equality | PASS |
| Source library post-export | 20k assets, 10 tags, 5 collections intact | equality | PASS |

### Evidence boundary and findings

The test does not compare every persisted value. Its current assertions are:

- exact counts for 20,000 assets, revisions, trashed rows, tags, collections, and aggregate tag /
  collection membership counts;
- 200 sampled asset path/size/location checks;
- 50 sampled metadata checks;
- up to 100 sampled per-asset tag memberships and 100 sampled collection memberships;
- `.serpent/trash` exists and is non-empty after round-trip.

It does not byte-compare every managed/trash file, inspect every metadata or relationship row, verify
every revision payload, validate artifacts/jobs, exercise linked content at 20k scale, or cover
packaged/Windows/non-ASCII/long-path portability. Accordingly, the historical result is: **no
mismatch or pathological slowdown was detected inside the asserted boundary**. The real-trash API
strengthening is fixed in `f1330a7`, but its final merged-gate result remains pending; prior timing
numbers must not be presented as the current final candidate result.
