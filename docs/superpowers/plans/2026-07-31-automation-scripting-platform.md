# Automation Scripting Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 0023 Phase A–F 的受控 JS/TS Console、同源 MCP Action、低风险与高风险写入、headless 建库/打开绑定、Undo Group 记录以及双平台分发验证。

**Architecture:** 所有入口通过 Main-owned Execution Resolver 进入 Automation Command Gateway；Gateway 使用唯一 Registry 完成 Schema、能力、批准、计划、取消、日志和 Worker 调度。脚本运行在可终止 UtilityProcess，MCP 在连接生命周期内运行 headless host，Library Worker 继续独占 SQLite、文件和 Job。

**Tech Stack:** Electron 43 UtilityProcess、TypeScript 6、Zod 4、QuickJS/WASM、SQLite/better-sqlite3、Vitest、Playwright Electron E2E、Electron Forge。

## Global Constraints

- 不恢复通用 CLI、`serpent run` 或 `serpent repl`。
- Renderer 不执行用户脚本，不接收任意路径、SQL、Node、Shell、网络或秘密。
- Script、Console、MCP 对同一 Action 使用同一 Registry、Schema、错误和批准语义。
- 无库 headless Execution 只能执行 `library.create`；创建后必须成功打开/初始化并显式绑定，后续 Action 才能执行。
- `file.import`、移动、重命名和移入回收站必须经过不可变 Execution Plan 和本机批准；永久删除与整库删除继续禁止。
- 可撤销操作返回并持久化 `undoGroupId`；应用级 `Ctrl/Cmd+Z` 以后按 Undo Group 撤销，不暴露组内半完成状态。
- 任何 packaged、Windows 或 Computer Use 未执行项必须记录为未验证。
- 新增行为先写失败测试并运行确认失败，再写最小生产实现。

---

## Task 1: 固定公共契约、headless 状态和 Undo Group

**Files:**
- Modify: `src/automation/command-registry.ts`
- Modify: `src/automation/command-gateway.ts`
- Modify: `src/main/automation-execution-journal.ts`
- Modify: `src/shared/automation-script-api.ts`
- Modify: `src/shared/protocol/errors.ts`
- Test: `tests/unit/automation-command-gateway.test.ts`
- Test: `tests/unit/automation-execution-journal.test.ts`
- Test: `tests/unit/automation-script-ipc.test.ts`

**Interfaces:**
- Reserves the `AutomationUndoGroup` / `undoGroupId` result boundary for Task 4; this task only records the semantic decision and implements the library-binding state.
- Produces stable failures for `AUTOMATION_LIBRARY_NOT_BOUND`, `AUTOMATION_LIBRARY_OPEN_FAILED`, and stale/invalid undo references.

- [ ] **Step 1: Write failing tests**
  - Assert a no-library execution accepts only `library.create`.
  - Assert a command other than `library.create` is rejected before Worker dispatch while the execution is unbound.
  - Assert an execution cannot bind a created library until the open/initialization callback succeeds.
  - Assert two file mutations in one user-intent scope share `undoGroupId`, and a partially successful group reports reversible and non-reversible members separately.
- [x] **Step 2: Run the focused tests and verify the expected failures**

  Run:

  ```bash
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
    tests/unit/automation-command-gateway.test.ts \
    tests/unit/automation-execution-journal.test.ts \
    tests/unit/automation-script-ipc.test.ts
  ```

  Expected: failures for missing unbound-library policy and undo-group fields.
- [x] **Step 3: Implement the smallest contract change**
  - Make `libraryId` optional only for a deliberately unbound journal record.
  - Add a Main-owned bind/open transition; reject renderer/MCP-supplied library binding.
  - Record the undo-group boundary without claiming Worker rollback or shortcut support.
  - Keep `Ctrl/Cmd+Z` UI dispatch out of this task; this task records the shared semantic boundary only.
- [x] **Step 4: Re-run the focused tests, then typecheck**

  Run:

  ```bash
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
    tests/unit/automation-command-gateway.test.ts \
    tests/unit/automation-execution-journal.test.ts \
    tests/unit/automation-script-ipc.test.ts
  npm run typecheck
  ```

- [x] **Step 5: Update `docs/development/2026-07-31-automation-scripting-platform-development-log.md` with the contract decision and test result.**

## Task 2: Complete cross-process write coordination

**Files:**
- Modify: `src/worker/library-write-coordinator.ts`
- Modify: `src/worker/bounded-write-command.ts`
- Modify: `src/worker/index.ts`
- Modify: `src/worker/library-service.ts`
- Modify: `src/shared/protocol/requests.ts`
- Modify: `src/shared/protocol/responses.ts`
- Test: `tests/unit/library-write-coordinator.test.ts`
- Test: `tests/worker/bounded-write-command.test.ts`
- Test: new `tests/worker/automation-write-fencing.test.ts`

**Interfaces:**
- Produces a lease owner heartbeat/renewal and fencing token for long-running file Jobs.
- Produces durable change-sequence notifications that allow Main/MCP clients to refresh after another process commits.
- Produces duplicate-claim rejection and recovery ownership transfer after expiry.

- [x] **Step 1: Write failing lease and fencing tests**
  - Start two independent coordinator instances against one fixture database.
  - Verify only one owner can renew or commit.
  - Verify an expired owner cannot commit after another owner acquires the lease.
  - Verify a detached Job cannot be claimed twice and an expired owner can be reclaimed.
  - Verify every committed mutation advances the library change sequence exactly once.
- [x] **Step 2: Run the worker tests and capture the expected missing heartbeat/fencing failures.**
- [x] **Step 3: Implement heartbeat, owner fencing, detached Job claim/release, and change-sequence event payloads using the existing SQLite lease authority.**
- [x] **Step 4: Run focused worker tests and the existing write-coordination regression set.**

  ```bash
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
    tests/unit/library-write-coordinator.test.ts \
    tests/worker/bounded-write-command.test.ts \
    tests/worker/automation-write-fencing.test.ts
  ```

- [x] **Step 5: Update `docs/development/2026-07-29-automation-write-coordination-development-log.md` and the `Serpent-bb56.2` task notes with evidence.**
  - 2026-07-31：补齐 `library.change-sequence` Worker 只读命令与 `tests/worker/automation-write-fencing.test.ts`（跨进程 change-sequence / lease busy / expired renew）。file_operations applying heartbeat 与 MCP 订阅仍未完成，`Serpent-bb56.2` 保持 in_progress。

## Task 3: Implement Phase E plan generation and approval for library creation/import

**Files:**
- Modify: `src/automation/command-registry.ts`
- Modify: `src/automation/command-gateway.ts`
- Modify: `src/main/automation-file-plan-approval.ts`
- Modify: `src/main/automation-worker-adapter.ts`
- Modify: `src/shared/protocol/requests.ts`
- Modify: `src/shared/protocol/responses.ts`
- Test: `tests/unit/automation-file-plan-approval.test.ts`
- Test: `tests/unit/automation-command-gateway.test.ts`
- Test: new `tests/worker/automation-library-create-import.test.ts`
- Test: new `tests/e2e/automation-script-library-create-import.test.ts`

**Interfaces:**
- Adds Registry commands `library.create` and `file.import`, plus plan descriptors for move, rename and trash.
- Produces an opaque plan proof bound to normalized inputs, entity state tokens, library change sequence, and `undoGroupId`.
- Produces a result that distinguishes complete success, partial success, skipped/conflicting items, Job handles, Undo references, and stale-plan rejection.

- [ ] **Step 1: Write failing Registry/Gateway tests**
  - Assert the new command IDs, capabilities, impact, approval policy, atomicity, MCP exposure and undo metadata.
  - Assert a plan hash changes when input, target state, or change sequence changes.
  - Assert an approval proof from another library or another execution is rejected.
  - Assert stale plans fail before filesystem mutation.
- [ ] **Step 2: Run the focused unit tests and verify failures are caused by missing commands/plan behavior.**
- [x] **Step 3: Implement normalized plan creation and Main-only approval**
  - Extend the plan handler to build previews for import and library creation without exposing absolute paths to the script.
  - Keep real source paths inside Main/Worker.
  - Require approval for both Console and MCP, with no caller-controlled bypass.
- [x] **Step 4: Implement Worker execution**
  - Reuse existing `library.create` and file-operation recovery primitives.
  - For headless creation, create the library, open/initialize its Worker session, then bind the Execution before returning a usable library reference.
  - Reject imports and other library-scoped commands while the Execution is unbound or the created library is not open.
- [ ] **Step 5: Run focused unit/worker tests and the new Electron E2E in the background.**

  ```bash
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
    tests/unit/automation-command-gateway.test.ts \
    tests/unit/automation-file-plan-approval.test.ts \
    tests/worker/automation-library-create-import.test.ts
  node scripts/run-e2e.mjs tests/e2e/automation-script-library-create-import.test.ts
  ```

- [ ] **Step 6: Update the Phase E development log, QA report, and human checklist entries for plan approval and headless create/open/import.**

## Task 4: Add shared Undo Group persistence and recovery hooks

**Files:**
- Modify: `src/main/automation-execution-journal.ts`
- Modify: `src/worker/library-service.ts`
- Modify: `src/shared/protocol/requests.ts`
- Modify: `src/shared/protocol/responses.ts`
- Test: `tests/unit/automation-execution-journal.test.ts`
- Test: new `tests/worker/automation-undo-group.test.ts`

**Interfaces:**
- Produces durable group membership, group terminal status, reversible item references, and recovery/partial-success reasons.
- Does not yet expose application `Ctrl/Cmd+Z`; it establishes the public domain object that the later desktop shortcut will call.

- [x] **Step 1: Write failing tests for group creation, append, terminalization, partial success, restart recovery, and invalid group reuse.**
- [x] **Step 2: Run the focused tests and verify missing group persistence failures.**
- [x] **Step 3: Implement the group journal and Worker recovery reference wiring without duplicating file-operation logic.**
- [x] **Step 4: Run focused tests and verify an interrupted group is not reported as fully undoable.**

## Task 5: Complete MCP write tools and headless host lifecycle

**Files:**
- Modify: `src/main/automation-mcp-host.ts`
- Modify: `src/main/automation-mcp-bootstrap.ts`
- Modify: `scripts/run-mcp.mjs`
- Modify: `src/shared/automation-script-api.ts`
- Modify: `tests/unit/automation-mcp-bootstrap.test.ts`
- Modify: `tests/unit/automation-command-gateway.test.ts`
- Test: new `tests/e2e/automation-mcp-write-approval.test.ts`

**Interfaces:**
- MCP `tools/list` is generated from Registry metadata.
- MCP `tools/call` creates/uses a Main-owned Execution and returns the same result/plan/approval/error contract as Console.
- Headless host can create and open a library before subsequent operations; it cannot infer a library from cwd, recent history, GUI focus, or MCP arguments.

- [ ] **Step 1: Write failing protocol tests for write-tool visibility, unbound-library rejection, plan approval, stdout purity, and self-authorization rejection.**
- [ ] **Step 2: Run MCP unit tests and verify the missing behavior.**
- [ ] **Step 3: Implement MCP write mapping through the existing Gateway and journal; do not add direct Worker or filesystem calls to the adapter.**
- [ ] **Step 4: Run a background Electron E2E covering create/open/bind/import and a stale-plan failure.**
- [ ] **Step 5: Record real two-host smoke requirements and any unavailable host/platform evidence without marking it passed.**

## Task 6: Finish Desktop Automation Console and application Undo entrypoint

**Files:**
- Modify: `src/renderer/ScriptSandboxPreviewDialog.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/shared/automation-script-api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/automation-script-ipc.ts`
- Modify: `src/renderer/i18n/catalogs/zh-CN.ts`
- Modify: `src/renderer/i18n/catalogs/en.ts`
- Test: `tests/unit/automation-script-ipc.test.ts`
- Test: new `tests/unit/automation-undo-shortcut.test.ts`
- Test: new `tests/e2e/automation-script-console.test.ts`

**Interfaces:**
- Console supports script list/open/save, capability summary, execution history, log navigation, stop/cancel, and plan approval.
- Renderer requests application-level undo by `undoGroupId`; it does not implement file rollback itself.

- [ ] **Step 1: Write failing UI/controller tests for no-library state, create/open/bind flow, history refresh, plan approval, and `Ctrl/Cmd+Z` dispatch.**
- [ ] **Step 2: Run focused tests and verify missing UI behavior.**
- [ ] **Step 3: Extract or extend a focused automation controller so new interaction logic does not grow `App.tsx` inline.**
- [ ] **Step 4: Implement typed IPC and localized states for awaiting authorization, awaiting plan approval, stale plan, partial success, undo available, and undo unavailable.**
- [ ] **Step 5: Run the new Electron E2E in the background and validate actual persisted library/file state, not only DOM state.**
- [ ] **Step 6: Add the corresponding human acceptance entries as `待人类验收`; do not mark them passed.**

## Task 7: Package types, MCP launcher, Skills, and documentation

**Files:**
- Modify: `scripts/run-e2e.mjs`
- Modify: `scripts/verify-package.mjs`
- Modify: `forge.config.ts`
- Modify: `vite.script-runtime.config.ts`
- Modify: `scripts/run-mcp.mjs`
- Modify: `package.json`
- Create: `docs/skills/serpent-automation/SKILL.md`
- Create/modify: generated automation `.d.ts` under `docs/skills/serpent-automation/`
- Modify: `docs/manual/scripts/development.md`
- Test: `scripts/verify-package.mjs` package assertions and `tests/e2e/packaged-startup.test.ts`

**Interfaces:**
- Packaged app contains the same Registry/API version used by Console and MCP.
- `serpent-mcp` remains a protocol launcher, not a general-purpose CLI.
- Generated Skills only describe Registry commands and their current permission/approval semantics.

- [ ] **Step 1: Write failing package assertions for Script Runtime, Registry version, type declaration, MCP launcher, and ASAR resources.**
- [ ] **Step 2: Run package assertions against the current package and capture the expected missing-artifact failures.**
- [ ] **Step 3: Add the runtime/type/launcher resources and build-time version consistency check.**
- [ ] **Step 4: Update user documentation with headless create/open/bind, plan approval, Undo Group semantics, security boundaries, and troubleshooting.**
- [ ] **Step 5: Rebuild current HEAD and run macOS packaged smoke; record Windows as unverified if no runner exists.**

## Task 8: Final verification and handoff

**Files:**
- Modify: all affected development logs and QA reports
- Modify: `docs/qa/human-acceptance-checklist.md`
- Modify: `docs/project-status.md`

- [ ] **Step 1: Run typecheck, lint, focused unit/worker suites, and all affected Electron E2E in background jobs.**
- [ ] **Step 2: Rebuild native dependencies if packaging changed the Electron ABI, then rerun the source test suite.**
- [ ] **Step 3: Run `npm run verify:mainline` only after the final shared worktree state is assembled.**
- [ ] **Step 4: Run the required two-axis code review with the user-selected `composer-2.5` model before claiming the large feature complete.**
- [ ] **Step 5: Resolve review findings, rerun affected tests, and document every unexecuted Windows/packaged/Computer Use item.**
- [ ] **Step 6: Do not create a git commit or push unless the user explicitly requests it; provide the exact changed files, test evidence, acceptance IDs, and remaining verification gaps.**
