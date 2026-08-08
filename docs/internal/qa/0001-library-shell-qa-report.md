# Slice 0001 QA report

> Status: conditional pass

## Build under test

- Branch: `codex/slice-001-library-shell`
- Commit: `ae1fcf4b5646c46a7334024032c99dfb8549b576`
- macOS environment: arm64, macOS, Node 24.15.0, npm 11.12.1; repository on SMB and execution staging on local APFS
- Windows environment: no runner confirmed

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Lint | Pass | `npm run lint` |
| Typecheck | Pass | `npm run typecheck` |
| Unit tests | Pass | 28/28, protocol, lifecycle events and name/path rules |
| Worker integration tests | Pass | 13/13, creation/open/move/corruption/version/audit/cleanup cases |
| Electron smoke tests | Pass | 4/4 production-bundle flows plus 1/1 real packaged-app startup |
| Package build | Pass on macOS arm64 | `npm run package`; `npm run verify:package` |
| Production dependency audit | Pass | `npm audit --omit=dev --registry=https://registry.npmjs.org`: 0 vulnerabilities |

## Security checks

- BrowserWindow uses sandbox, context isolation and no Node integration.
- Both development-staged and packaged Renderer checks found no page `process` or `require`.
- Renderer exposes only semantic library methods and a validated lifecycle subscription; arbitrary paths remain Main-owned.
- Main rejects IPC senders other than the active window and publishes only schema-validated lifecycle events.
- CSP restricts sources to the application, required local development connections, data/blob images and blob media.
- Worker owns SQLite and filesystem operations; Main contains no SQL.

## Library lifecycle checks

Planned checks cover create/open/close, migration idempotency and rollback, invalid/future/corrupt databases, target conflicts, cleanup failure, moved-library identity, duplicate open, request serialization, and recovery after an earlier failure.

Resolved test definitions:

- `PRAGMA user_version` is the schema authority; migration rows are audit evidence.
- Missing database or `Assets/` is an error; missing regenerable internal directories are rebuilt.
- Duplicate open returns the existing summary without another connection.
- Closed-library movement is tested; moving an open library is out of scope.
- macOS close-window and explicit-Quit lifecycles are tested separately.
- The dialog test adapter must be unreachable in production builds.

## Platform QA

- macOS: pass for arm64. The real packaged app was copied from SMB to APFS before execution because macOS cannot validate Electron bundles directly on this SMB mount.
- Windows: not run; requires a Windows machine or CI runner. This cannot be reported as passed.

## Findings

- Resolved: Renderer root/HTML entry mismatch.
- Resolved: corrupted Rolldown native binding after interrupted install.
- Resolved: Worker CJS bundle converted `import.meta.url` to undefined.
- Resolved: external `better-sqlite3` omitted from ASAR; production dependencies are now retained, pruned and native code unpacked.
- Resolved: Electron test runtime and Node integration module used different ABIs; E2E now consumes the packaged ABI 148 staging tree.
- Environment limitation: Electron application bundles cannot be reliably executed from the SMB workspace; APFS staging is required for macOS QA.
- Unexecuted: Windows package/create/open/sandbox QA.
- Production dependencies: audit passed with 0 vulnerabilities. Development-only tool advisories remain outside the shipped dependency set.

## Final result

Conditional pass. The macOS arm64 vertical slice and packaged runtime satisfy automated and visual QA. Windows remains explicitly unverified, so the cross-platform slice cannot be called fully accepted until a Windows runner executes the same package and lifecycle suite.
