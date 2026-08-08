# Slice 0002 development log: asset ingestion

> Status: implementing
> Started: 2026-07-12
> Last updated: 2026-07-12

## References

- Spec: `docs/internal/implementation/0002-asset-ingestion-vertical-slice.md`
- Process: `docs/internal/development-process.md`
- Branch: `codex/slice-002-asset-ingestion`
- Base commit: `ae1fcf4b5646c46a7334024032c99dfb8549b576`

## Confirmed test seams

- v1 → v2 migration and asset repository API.
- Import conflict planning/resolution with filesystem fixtures.
- External change reconciliation.
- Electron folder/import/conflict user flow.

## Progress

- Slice 0001 completed and committed.
- Scope and file-transaction invariants recorded before implementation.
- Added semantic Renderer IPC for managed folders, asset listing, file/folder selection intent,
  opaque conflict resolution, explicit import abandonment, and external-change refresh.
- Main remains the only process that opens system file/folder dialogs and forwards source absolute
  paths to the Worker; Preload exposes only frozen semantic methods and renderer-safe summaries.
- Replaced the shell placeholder with a dense three-pane asset workspace: real folder tree, managed
  asset grid, import tools, conflict decision dialog, progress/result feedback, missing state, and
  selection inspector.
- Fixed real-folder import for `/Users/dolag/Documents/Temp/参考`: four valid existing file names
  were 90–99 characters long and had been incorrectly rejected by the 80-character managed-folder
  display-name rule. Import paths no longer use that UI naming limit.
- Added renderer-safe failure reasons and persistent structured logging for Worker/Main failures.

## Decisions

- Import conflict prompts operate on opaque Worker-owned plan IDs; Renderer never receives or resubmits source paths.
- A filesystem watch event only schedules reconciliation; database state changes only after stat-based verification.
- The root of `Assets/` is represented by a null `managed_folder_id`, not a fake folder row.
- Closing a conflict prompt explicitly abandons its opaque plan. A discarded token cannot later be
  resolved; this avoids staging leaks and makes cancel behavior observable at the Worker boundary.
- Conflict examples are validated as display names, not filesystem paths; the renderer protocol
  rejects path separators in this renderer-visible field.
- Existing imported path components have no Serpent-defined length ceiling. The current target
  filesystem decides its actual component/total-path limits during mkdir/copy/rename; errors such as
  `ENAMETOOLONG`, `EACCES`, `ENOSPC`, `EROFS`, and `EIO` are mapped to stable renderer-safe reasons.
- Full diagnostics stay outside Renderer IPC. The UtilityProcess stderr stream is persisted by Main
  as structured JSON lines at `path.join(app.getPath('logs'), 'serpent.log')`.

## Native module test runtime

- The development shell uses Node 24.15.0 (`NODE_MODULE_VERSION=137`). Electron 43.1.0 embeds Node
  24.18.0 but exposes Electron ABI 148.
- Electron Forge rebuilds `better-sqlite3` for ABI 148. Running Worker tests afterward with the host
  Node binary fails before business assertions with `ERR_DLOPEN_FAILED`; this is an ABI mismatch,
  not evidence that Node 24 or the Worker implementation is broken.
- Keep Node 24 LTS. Run pure unit tests with host Node and native Worker integration tests with
  `ELECTRON_RUN_AS_NODE=1 <electron> <vitest> ...`. A future cross-platform npm wrapper must set the
  environment through Node `spawn`, rather than relying on POSIX-only inline environment syntax.
- Node 23 is not an accepted workaround: it is EOL and does not match Electron ABI 148.

## Verification log

- `npm run test:unit -- --run tests/unit/protocol.test.ts` — passed (30 tests across 2 files at run time).
- `npm run typecheck` — passed after the semantic protocol and UI integration.
- `npm run lint` — passed.
- `git diff --check` — passed.
- `npm run test:unit` — passed (42 tests after error-protocol and persistent-log coverage).
- Electron-as-Node Worker suite — passed (53 tests after long existing-name regression coverage).
- Electron E2E — passed (6 tests, including safe import reason plus persisted Worker diagnostic).
- Manual real-folder import of `/Users/dolag/Documents/Temp/参考` — passed: 150/150 files copied and
  registered in a disposable local resource library; the disposable library was removed afterward.

## Failures and resolutions

- Real folder import failed as `INVALID_IMPORT_SOURCE` with only a generic “导入失败” UI. Root cause:
  import enumeration reused `normalizeFolderName` for every file component, imposing an unrelated
  80-character UI rule. The rule was removed from existing import paths and a regression test added.
- Direct `npm run test` failed for 49 SQLite-backed cases because `better-sqlite3` had been rebuilt
  for Electron ABI 148 while host Node required ABI 137. Running the same Worker suite under the
  Electron runtime passed; the runtime strategy is recorded above.

## Known risks and next work

- Windows filesystem conflict and rename semantics need a Windows runner.
- Crash recovery across database commit and multi-file rename requires explicit fault-injection tests.

## 2026-08-04 sequence import batch decisions

- Automatic sequence synthesis now requires equal decoded pixel dimensions for every candidate frame.
  The Worker uses a bounded header probe for common raster formats and rejects unknown/corrupt headers
  instead of falling back to filename-only grouping. The import probe already uses Sharp for the same
  rule before the confirmation dialog.
- The sequence import dialog now walks multiple candidates in order. Choosing normal assets leaves
  later candidates for the next confirmation; applying the current choice to the rest expands complete
  frame paths for later candidates, so a single selected frame cannot silently truncate a sequence.
- Added one Worker mutation for dissolving multiple selected sequences. The asset context menu shows
  `解散序列图（N 项）` only when every selected asset is a sequence.
- Evidence: `tests/worker/image-sequence.test.ts` 14 passed; sequence-import/protocol/image-sequence
  focused tests 84 passed; full `npm run test` 321 files passed / 3 skipped, 2787 tests passed / 8
  skipped; typecheck and lint passed. `verify:mainline` reached the E2E suite but remained red on the
  pre-existing `asset-pagination` stale fixture waiting for the 回收站 button; no sequence test failed.
- Human acceptance remains pending for the dialog flow, multi-candidate behavior, and multi-select
  dissolve. Packaged and Windows evidence remain unexecuted.
