# Slice 0003 code review: linked folders

> Status: re-reviewed; not accepted
> Date: 2026-07-13

## Review ranges

- Original fixed range: `git diff 8dc2470...cdc2247`
- Original commits: `3c8c92b`, `b73ae51`, `3759add`, `cdc2247`
- Re-review: uncommitted working-tree changes present on 2026-07-13, limited to slice-0003-relevant code/tests.
- Spec: `docs/implementation/0003-linked-folders-vertical-slice.md`

## Standards

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Renderer/Main/Worker architecture boundary | Semantic IPC and Main-owned dialogs preserve the boundary; Renderer does not receive linked absolute paths. | No regression found in targeted review/tests. | resolved/pass |
| v4 migration could cascade-delete revisions | Corrected in the reviewed commits by toggling FK outside the rebuild and running `foreign_key_check`. | Regression coverage remains green. | resolved |
| Development record was not maintained continuously | Existing log stopped before full wiring although implementation continued. This violates `docs/development-process.md`. | This report and the rebuilt log disclose the provenance; historical process evidence cannot be recreated. | documented process deviation |
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
Spec: core behavior is implemented and automatically verified, but symlink semantics and manual/Windows QA remain open. Slice may proceed through review, not acceptance.
