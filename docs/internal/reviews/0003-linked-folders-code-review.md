# Slice 0003 code review: linked folders

> Status: re-reviewed; not accepted
> Date: 2026-07-13

## Review ranges

- Original fixed range: `git diff 8dc2470...cdc2247`
- Original commits: `3c8c92b`, `b73ae51`, `3759add`, `cdc2247`
- Re-review: uncommitted working-tree changes present on 2026-07-13, limited to slice-0003-relevant code/tests.
- Spec: `docs/internal/implementation/0003-linked-folders-vertical-slice.md`

## Standards

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Renderer/Main/Worker architecture boundary | Semantic IPC and Main-owned dialogs preserve the boundary; Renderer does not receive linked absolute paths. | No regression found in targeted review/tests. | resolved/pass |
| v4 migration could cascade-delete revisions | Corrected in the reviewed commits by toggling FK outside the rebuild and running `foreign_key_check`. | Regression coverage remains green. | resolved |
| Development record was not maintained continuously | Existing log stopped before full wiring although implementation continued. This violates `docs/internal/development-process.md`. | This report and the rebuilt log disclose the provenance; historical process evidence cannot be recreated. | documented process deviation |
| Naming clarity | `refreshManagedAssets` now handles both managed and linked assets (possible Mysterious Name). | Still present. | non-blocking debt |

## Spec

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Linked import/offline/relink/stable ID/UI | Implemented across Worker, protocol, Main, Preload, Renderer and E2E. | 16/16 linked/watcher tests pass. | implemented |
| Linked-folder list scope | Original wiring attempted managed-folder resolution for linked IDs and could throw `FOLDER_NOT_FOUND`. | Fixed by resolving/filtering linked scope; commit `3759add`. | resolved |
| Nested symbolic links | Spec text says “符号链接拒绝”; implementation safely skips and logs them. | Behavior is tested but deviation remains unconfirmed. | open Spec deviation |
| Windows behavior | Required cross-platform confidence is absent. | No Windows run. | open QA risk |

## Re-review conclusion

Standards: no current blocking architecture defect; one historical process deviation and one naming debt.
Spec: core behavior is implemented and automatically verified, but symlink semantics and ../../manual/Windows QA remain open. Slice may proceed through review, not acceptance.

## 2026-07-14: D1/D2 re-review re-verification + fix

> Scope: re-review findings in docs/internal/qa/0003-linked-folders-qa-report.md.

### D1 (MEDIUM): Re-verified as re-review misread -- no code change

The re-review claimed `enumerateLinkedSources` `canPrune` would prune all directories with all rules disabled. Code tracing disproves this: `canPrune = true && false = false` (directory not pruned). Added worker test confirms new files ARE registered after refresh with all rules disabled. **Verdict: re-review misread the `&&` operator; code is correct.**

### D2 (LOW): Fixed -- non-ENOENT lstat errors in relinkMissingFolder

The re-review correctly found that `relinkMissingFolder` would `throw IMPORT_APPLY_FAILED` on any non-ENOENT/non-ENOTDIR `lstatSync` error for a single asset, aborting the entire relink batch. **Fix**: replaced `throw` with `this.diagnose(...)` + continue (skip problematic asset, leave it missing, continue with remaining assets). Worker test with EACCES simulation verifies the fix.

**Verdict: real bug, fixed.**

### Standards review (2026-07-14 additions)

| Finding | Status |
| --- | --- |
| D1 relink-abort fix: per-asset error handling in batch operations | resolved -- diagnose + continue, not throw |
| D1 re-verify test: verifies refresh behavior with all rules disabled | passed |
| D2 fix test: chmod-based EACCES simulation for per-asset skip | passed |
| Restart-restore E2E: SERPENT_E2E_USER_DATA_PATH + SERPENT_E2E_RESTORE_RECENT | passed |
| Filter-rules E2E: .git/node_modules ignored, real assets registered | passed |
