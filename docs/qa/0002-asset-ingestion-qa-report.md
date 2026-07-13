# Slice 0002 QA report

> Status: test design in progress

## Build under test

- Branch: `codex/slice-002-asset-ingestion`
- Commit: pending

## Automated gates

The implementation is still in progress. The following black-box acceptance matrix is the QA contract for this slice.

| Area | Scenario | Observable acceptance result | Planned layer |
| --- | --- | --- | --- |
| Folder hierarchy | Create a root folder and nested child folder | Both nodes appear in the tree and map to matching directories below `Assets/` | Electron E2E + disk assertion |
| File import | Import one and multiple files into root/a selected folder | Files are copied to the chosen location; cards appear with name, size and available state | Electron E2E + disk assertion |
| Directory import | Import a directory containing nested directories | Source directory name and complete hierarchy are preserved | Electron E2E + disk assertion |
| Empty directory import | Import a hierarchy containing empty directories | Empty directories and the selected source root directory remain present below the target | Electron E2E + disk assertion |
| Restart identity | Close/relaunch after import | Folder tree and assets return; asset IDs remain stable | Electron E2E + bridge assertion |
| Suspected duplicate | Import same-name/same-size inputs | No final mutation occurs before resolution; skip/merge/create-copy decisions have the documented result | Worker integration + Electron conflict UI |
| Name conflict | Import different content to an occupied name | Default keep-both uses a portable numbered name; replace and skip obey the selected batch policy | Worker integration + Electron conflict UI |
| Cancel/invalid token | Cancel conflict UI or submit an invalid/reused token | No visible file/database artifact remains and token cannot be replayed | Worker integration + Electron E2E |
| Close cleanup | Close one library or shut down all libraries while plans are pending | Pending tokens become invalid and their staging/backup directories are removed | Worker integration + Electron E2E |
| Symlink boundary | Import a tree containing a symlink escaping the selected tree/library boundary | Operation is rejected without following/copying bytes outside the permitted tree | Worker integration security test |
| Failure rollback | Inject copy, rename or database failure | No visible half-file, orphan asset/revision or false available record remains | Worker integration fault injection |
| Failure ordering | Fail each rename/database boundary after earlier files have applied | Filesystem restoration occurs in reverse order and restores replaced bytes as well as new paths | Worker integration fault injection |
| Asset listing | Change folder scope and recursive mode | Grid reflects only the requested scope and supported recursion semantics | Electron E2E + API assertion |
| External overwrite | Replace bytes outside Serpent and refresh | Asset ID is stable, a new external-change revision becomes current | Worker integration + Electron E2E |
| External move/delete | Move or delete a managed file and refresh | Original asset is marked missing; Serpent does not guess the new path | Electron E2E + API assertion |
| Refresh idempotency/recovery | Refresh an already-missing file repeatedly, then restore the same path | Missing is not counted repeatedly; restoring the path returns the same asset to available with one new external-change revision | Worker integration + Electron E2E |
| Background observation | Open/close libraries and emit a burst of untrusted filesystem events | Open starts one observer, close/closeAll stop it, a burst coalesces into one stat-based refresh, and event payload paths never directly mutate database state | Worker integration with fake observer/timer |
| Replace/merge identity | Resolve name conflict as replace or suspected duplicate as merge | Existing asset identity is preserved; replace advances its revision and merge creates no duplicate asset | Worker integration |
| Renderer boundary | Inspect exposed bridge and conflict payloads | Renderer cannot submit source paths; plan omits absolute source paths | Unit/protocol + Electron evaluate |
| Packaging | Run packaged application from local APFS staging | Import flow starts and packaged native SQLite remains loadable | Packaged Electron smoke |
| Error reason and log | Trigger a filesystem failure | UI shows a path-safe actionable reason; `serpent.log` records system code, stack, context and cause chain | Unit + Electron E2E |

Cancellation during the native picker is expected to be a no-op. Cancellation after a conflict plan must invalidate or abandon the pending plan without modifying the final destination.
Unknown, forged, abandoned and already-consumed import tokens must all fail through a stable public error shape without exposing Worker state or filesystem paths.

## Platform QA

- macOS: pending.
- Windows: no runner currently available; cannot be reported as passed.

## Findings

- Test environment constraint carried from slice 0001: the SMB workspace can build the application, but executable `.app` QA must use a local APFS staging directory.
- Windows remains unavailable in the current environment and must stay explicitly unverified.
- Host Node and Electron use different native ABIs even though both embed Node 24. SQLite-backed
  Worker tests must run under Electron (`ELECTRON_RUN_AS_NODE=1`); pure unit tests remain on host Node.
- Regression verification on `/Users/dolag/Documents/Temp/参考` passed with all 150 files imported.
  The former failure was caused by an incorrect 80-character file-name check, not a platform path limit.
- Persistent application diagnostics are written to `path.join(app.getPath('logs'), 'serpent.log')`;
  Renderer receives only stable reason codes and never absolute source paths.
- The error-observability E2E used a source directory containing a symbolic link: the UI reported the
  specific safe reason and the persisted log contained `SYMBOLIC_LINK_NOT_ALLOWED` plus Worker scope.

## Final result

Not evaluated.
