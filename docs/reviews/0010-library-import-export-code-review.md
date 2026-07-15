# Slice 0010 code review: library import/export

> Status: candidate reviewed; final merged re-review pending
> Date: 2026-07-13 / calibrated 2026-07-16

## Review ranges

- Original fixed range: `git diff 8dc2470...cdc2247`
- Relevant original commits: `3aec6c3`, `2ffd226`
- Re-review candidate: `f1330a7` on 2026-07-16.
- Spec: `docs/implementation/0010-library-import-export-vertical-slice.md`
- The real-trash soak strengthening is fixed in `f1330a7`; final merged mainline SHA remains pending.

## 2026-07-15 evidence boundary

The current 20k soak improvement uses the real trash API and verifies a physical trash directory,
but it is not a complete equivalence oracle. Exact assertions cover aggregate counts; paths/sizes,
metadata, and per-asset relationships are sampled, and physical trash is checked only for existence
and non-empty contents. Artifacts/jobs, every file byte, every persisted row, 20k linked content,
packaged UI, non-ASCII/long paths and Windows↔macOS portability are outside this soak.

Accordingly, “no data loss”, “all asset data preserved” and “automated gates pass” are not current
review conclusions. The accurate status is: historical targeted checkpoints passed within their
asserted boundary; final merged verification remains pending.

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
Spec: the implementation has historical targeted automation and the soak strengthening is fixed in
`f1330a7`, but the final merged gate remains pending. Packaged transfer UI, complete large-library equivalence, non-ASCII/long
paths and Windows/cross-platform QA remain open.
