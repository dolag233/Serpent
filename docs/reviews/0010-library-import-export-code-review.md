# Slice 0010 code review: library import/export

> Status: fixing
> Date: 2026-07-13

## Review ranges

- Original fixed range: `git diff 8dc2470...cdc2247`
- Relevant original commits: `3aec6c3`, `2ffd226`
- Re-review: current uncommitted working tree on 2026-07-13.
- Spec: `docs/implementation/0010-library-import-export-vertical-slice.md`

## Standards

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Archive trust boundary | ZIP extraction trusted library helpers without complete portable-name, symlink or expansion limits. | Central-directory validation, path/symlink checks and expansion limits added. | resolved |
| Partial-output ownership | Failure/cancel cleanup could remove a caller-owned destination or leave partial output. | Destination ownership and failure cleanup strengthened; tests added. | substantially resolved |
| Cancellation API design | Operations originally exposed IDs only after work completed. | First progress publishes the ID; cooperative checkpoints allow a concurrent cancel request; owned partial output is cleaned and cleanup failure is diagnosed. | resolved automatically |
| Memory/scale | ZIP import used `adm-zip`, which centralized archive content handling. | Import now preflights and streams entries with `yauzl`; per-entry/total bytes, entry count, compression ratio and cancellation are enforced without loading the archive into one Buffer. | resolved automatically; large-real-library soak still QA |
| Development-process documentation | No contemporaneous document set existed. | Rebuilt documents disclose provenance. | documented process deviation |

## Spec

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Folder/ZIP round trip and validation | Implemented with snapshot, selection rules, standard-ZIP preflight and import validation. | 45 targeted tests pass. | implemented |
| ZIP traversal/symlink/bomb resistance | Original implementation was incomplete. | Working-tree tests cover hostile names, symlinks, compression ratio and ownership. | resolved |
| Live progress cancellation and cleanup | Spec requires user cancellation during an operation. | Folder/ZIP import/export announce IDs before completion; four real cancellation paths verify cleanup ownership. | implemented automatically |
| Cross-platform portability | No Windows/macOS cross-device round trip has been performed. | Still unverified. | open QA risk |
| Snapshot semantics | Implementation used synchronous `VACUUM INTO` despite the spec requiring Online Backup. | Folder and ZIP paths now call the SQLite Online Backup API, yield between page batches, verify `quick_check`, and preserve cleanup/cancellation behavior. | resolved |
| Linked content parity | ZIP ignored `includeLinkedContent` and UI only exposed it for folder export. | Both formats enumerate linked content into the operation manifest under collision-safe `_linked/` paths and report it in progress/summary. | resolved |

## Re-review conclusion

Standards: archive validation, output ownership and live cancellation are materially resolved.
Spec: automated implementation gates pass; large-library, packaged transfer-UI and Windows/cross-platform QA remain open.
