# Slice 0003 development log: linked folders

> Status: code-review（自动验证通过；人工与 Windows QA 未执行）
> Started: 2026-07-13
> Last updated: 2026-07-13
> Record provenance: **流程偏差**——本文主要由提交、当前源码和测试结果重建，并非从编码开始持续维护；不能把重建记录视为完整的实时开发轨迹。

## References and ranges

- Spec: `docs/implementation/0003-linked-folders-vertical-slice.md`
- Branch: `codex/slice-002-asset-ingestion`
- Base: `8dc24705413f4964b682cf452ba65bb39d3e00e3`
- Original review range: `8dc2470...cdc2247`
- Relevant commits: `3c8c92b`（Worker/core）、`b73ae51`（protocol/Main/Preload/Renderer/E2E）、`3759add` 与 `cdc2247`（linked scope/E2E fixes）
- Re-review: current uncommitted working tree on 2026-07-13; it also contains other slices' concurrent changes.

## Reconstructed implementation

- schema v3→v4 adds `linked_folders`, rebuilds `assets`, and replaces global path uniqueness with location-scoped partial indexes.
- Linked import enumerates without copying source bytes, applies default ignores, skips rather than follows symbolic links, and inserts folder/assets/revisions transactionally.
- Linked path resolution, offline/missing reconciliation, stable asset identity, relink with `external_change` revisions, linked sidebar/import/relink UI, and semantic IPC are wired end to end.
- Watchers observe managed and available linked roots but use stat-based refresh as the authority; working-tree changes add linked-root observer coverage and diagnostic logging for skipped symlinks.

## Important decisions and deviations

- v4 table rebuild disables foreign keys outside the migration transaction, performs the rebuild, runs `foreign_key_check`, then restores FK enforcement; this prevents revision loss caused by `DROP TABLE assets` cascades.
- Linked relative paths are scoped by linked folder, so uniqueness cannot remain global.
- The implementation skips nested symlinks and logs the skip. The spec originally used “符号链接拒绝”; this is a recorded Spec deviation and must be confirmed or the implementation changed before acceptance.
- The method remains named `refreshManagedAssets` although it now refreshes linked assets too. This is naming debt, not a behavioral blocker.

## Verification record

- Original development report reconstructed from commits: 8/8 repository E2E passed at `cdc2247`, including the linked-folder flow; this was not rerun during this documentation pass.
- Working-tree targeted run: linked folders + library watcher, **16/16 passed**.
- Working-tree `npm run lint`: passed.
- Working-tree `npm run typecheck`: passed.
- Final shared-tree gates: unit **139/139**, Worker **408/408**, Electron E2E **10/10**, lint/typecheck, package/verify and packaged startup/import **1/1** all passed.

## Known risks and next work

- Perform macOS UI/manual checks for import-as-linked, offline presentation, relink, restart identity, and safe error/log pairing.
- Run Windows QA for case-insensitive paths, volume changes, watcher behavior, relink, and packaging.
- Resolve the symlink “reject vs skip” specification deviation.
- Do not mark accepted until review/QA documents are complete and the outstanding platform/manual evidence is explicitly dispositioned.
