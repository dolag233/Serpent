# Desktop Attached Selection and Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an external local Agent to attach to the running Serpent Desktop, focus its window, and set the real asset selection shown by the Renderer while preserving the existing headless MCP mode.

**Architecture:** Keep domain operations such as search, import, metadata, tags, AI, and file movement on the existing Registry/Gateway/Worker path. Add a narrowly scoped, authenticated Desktop control plane for UI-only operations (`focus` and selection); attached MCP forwards these typed requests into the existing Main process, while headless MCP never exposes them. The Desktop Renderer receives a validated Main → Renderer event and updates the existing selection state, anchor, primary asset, and Inspector inputs through a focused hook rather than adding more inline logic to `App.tsx`.

**Tech Stack:** Electron Main/Renderer, TypeScript, Zod, stdio MCP, local Unix domain socket on macOS/Linux, named pipe on Windows, Vitest, Playwright Electron E2E.

## Global Constraints

- Renderer remains sandboxed and receives typed events only; it never receives Node.js, SQL, Shell, arbitrary network, or arbitrary filesystem access.
- Attached MCP is local-user-only and short-lived; it must not listen on a network interface or expose SQL, Shell, raw filesystem, secrets, or arbitrary UI automation.
- Domain writes continue through the Automation Command Gateway and retain execution authorization, file-plan confirmation, write fencing, idempotency, and undo semantics.
- Desktop attachment requires an explicit local confirmation showing the target library and requested read/write capabilities; the GUI focus library is never an implicit authorization.
- `--headless` remains an explicit supported mode and must not expose Desktop-only Focus or Selection tools.
- Selection changes are UI state only and must not create database writes, metadata revisions, execution plans, or Undo Groups.
- All MCP results and Renderer-visible payloads must avoid absolute filesystem paths.
- Node version remains `>=24 <25`; TypeScript remains pinned to `6.0.3`.
- Any new human-operable function must update `docs/qa/human-acceptance-checklist.md` in the same change set.
- Cross-process changes require focused unit/integration tests plus the relevant Electron E2E; the final merged tree must use `npm run verify:mainline`.

---

### Task 1: Define the Desktop control-plane contract

**Files:**
- Create: `src/shared/desktop-control.ts`
- Modify: `src/shared/protocol/channels.ts`
- Modify: `src/shared/protocol/errors.ts`
- Test: `tests/unit/desktop-control.test.ts`

**Interfaces:**
- Produces a Zod-validated request/response contract for local Desktop attachment, focus, and selection.
- Produces `DesktopControlSelectionRequest` with:
  - `libraryId`
  - `assetIds: string[]`, bounded to the existing automation batch limit
  - `mode: 'replace' | 'add' | 'remove'`
  - `requestId`
- Produces `DesktopControlSelectionResult` with:
  - `libraryId`
  - `mode`
  - `selectedAssetIds`
  - `primaryAssetId: string | null`
  - `ignoredAssetIds`
- Produces handshake/session messages with protocol version, process nonce, requested capabilities, and stable public error codes.
- Produces a typed Main → Renderer channel for applying a selection result.

- [ ] **Step 1: Write failing schema tests**

Cover valid replacement/add/remove requests, duplicate IDs, empty replacement, oversized batches, wrong library IDs, unknown message types, and rejection of absolute paths or arbitrary command names.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/unit/desktop-control.test.ts`

Expected: FAIL because the control-plane schemas and error codes do not yet exist.

- [ ] **Step 3: Implement the minimal schemas and channel constants**

Use strict Zod objects, bounded arrays, explicit enums, and stable public error codes. Keep the control contract separate from Worker requests because Focus and Selection do not mutate the library.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/unit/desktop-control.test.ts`

Expected: PASS.

### Task 2: Add Renderer-side automation selection handling

**Files:**
- Create: `src/renderer/use-desktop-automation-selection.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css` only if an existing selection indicator needs no new layout
- Test: `tests/unit/desktop-automation-selection.test.ts`
- Test: `tests/e2e/automation-desktop-selection.test.ts`

**Interfaces:**
- Consumes the typed Main → Renderer selection event from Task 1.
- Produces `onDesktopSelectionApplied` acknowledgment through the preload bridge.
- Uses the existing `setSelectedAssetIds`, `setSelectedAssetId`, and `setAssetSelectionAnchor` state paths.

- [ ] **Step 1: Write reducer tests**

Test:

```ts
applyDesktopSelection(
  { selectedAssetIds: ['a'], primaryAssetId: 'a' },
  { mode: 'replace', assetIds: ['b', 'c'] },
) === { selectedAssetIds: ['b', 'c'], primaryAssetId: 'c' };
```

Also cover add/remove deduplication, empty replacement, removed primary selection, ignored IDs, and preserving folder selection semantics.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/unit/desktop-automation-selection.test.ts`

Expected: FAIL because the reducer and hook do not yet exist.

- [ ] **Step 3: Implement the hook and preload bridge**

The hook must:

1. reject events for a different active `libraryId`;
2. apply the requested replace/add/remove mode;
3. update the primary asset and selection anchor consistently;
4. clear stale folder-card selection when asset selection is replaced;
5. avoid opening a preview or changing navigation implicitly;
6. acknowledge the applied IDs without exposing paths.

Extract this behavior from `App.tsx` into the focused hook; do not add a large inline event handler.

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/unit/desktop-automation-selection.test.ts`

Expected: PASS.

- [ ] **Step 5: Add and run a Renderer Electron E2E**

The E2E must create or open an isolated test library, load multiple assets, inject a valid attached-control selection event through the test seam, and assert:

- the corresponding asset cards have the existing selected state;
- the primary asset and Inspector agree with the selection;
- add/remove/replace produce the expected set;
- no database or file operation is triggered;
- stale-library events are ignored.

Run: `node scripts/run-e2e.mjs tests/e2e/automation-desktop-selection.test.ts`

### Task 3: Extract and harden Main window focus

**Files:**
- Create: `src/main/desktop-window-control.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/desktop-control.ts`
- Test: `tests/unit/desktop-window-control.test.ts`
- Test: `tests/e2e/automation-desktop-focus.test.ts`

**Interfaces:**
- Produces `focusSerpentDesktop(): { focused: boolean; reason?: 'not-running' | 'window-unavailable' }`.
- Reuses the existing restore/show/focus behavior used by second-instance and macOS activation.
- Does not expose a generic window handle or arbitrary BrowserWindow operations.

- [ ] **Step 1: Write failing focus behavior tests**

Cover a minimized window, a hidden window, an already focused window, a destroyed window, and a missing window. Verify that only the Serpent main window is affected.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/unit/desktop-window-control.test.ts`

Expected: FAIL because focus behavior is currently embedded in `src/main/index.ts`.

- [ ] **Step 3: Extract the focused implementation**

Move the existing `restore → show → focus` behavior behind a narrow injectable interface. On macOS, use the existing app activation path where required; on Windows, use the BrowserWindow activation path. Keep second-instance and `app.activate` behavior unchanged by delegating to this module.

- [ ] **Step 4: Run unit and existing shell tests**

Run: `npx vitest run tests/unit/desktop-window-control.test.ts tests/unit/window-control.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the real Desktop focus E2E**

Launch Serpent with an isolated userData directory, move or minimize the window through the existing test seam, invoke the attached focus command, and verify the window is visible and the application is the active target. Do not treat DOM presence as focus evidence.

Run: `node scripts/run-e2e.mjs tests/e2e/automation-desktop-focus.test.ts`

### Task 4: Implement the local Desktop control plane

**Files:**
- Create: `src/main/desktop-control-plane.ts`
- Create: `src/main/desktop-attach-session.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/automation-execution-journal.ts`
- Modify: `src/main/automation-mcp-bootstrap.ts`
- Modify: `src/main/automation-mcp-host.ts`
- Test: `tests/unit/desktop-control-plane.test.ts`
- Test: `tests/unit/desktop-attach-session.test.ts`

**Interfaces:**
- `DesktopControlPlane.start(options)` publishes a per-process local endpoint and returns a close handle.
- `DesktopAttachSession.attach(request)` performs handshake, verifies same-user/process nonce, asks the local user to confirm library/capabilities, and returns a session-scoped forwarding handle.
- Forwarded domain calls continue using the existing `AutomationExecutionJournal` and `AutomationCommandGateway`.
- Forwarded Desktop UI calls are limited to Focus and Selection.

- [ ] **Step 1: Write failing transport and authorization tests**

Cover:

- endpoint creation and cleanup;
- malformed frames and protocol-version mismatch;
- wrong nonce and unauthorized user rejection;
- session timeout and Desktop exit;
- attach confirmation denial;
- library binding confirmation;
- read-only versus write capability declaration;
- no control-plane operation after session close;
- no absolute path in public errors.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run tests/unit/desktop-control-plane.test.ts tests/unit/desktop-attach-session.test.ts`

Expected: FAIL because the transport and session modules do not exist.

- [ ] **Step 3: Implement the local endpoint**

Use a Unix domain socket under the current userData directory on macOS/Linux and a per-user named pipe on Windows. Restrict endpoint permissions to the current user, use length-delimited JSON frames, cap frame size, and issue a random per-process nonce. Never accept a command string or eval payload.

- [ ] **Step 4: Implement attach authorization**

On attach:

1. create a Main-owned `source: 'mcp'` execution;
2. display the target library and requested capabilities in a local confirmation;
3. bind the library only after confirmation;
4. keep plan confirmation in the existing Desktop UI;
5. close the session when Desktop exits or the control plane closes.

The Agent must not be able to self-authorize, select a different library silently, or elevate from read to write.

- [ ] **Step 5: Implement forwarding**

Route domain commands through the existing Gateway and route Focus/Selection through the typed Desktop control contract. Ensure `library.changed` is emitted through the existing Worker listener so the Renderer refreshes after domain writes.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/unit/desktop-control-plane.test.ts tests/unit/desktop-attach-session.test.ts tests/unit/automation-mcp-host.test.ts tests/unit/automation-mcp-bootstrap.test.ts`

Expected: PASS.

### Task 5: Add attached MCP tools and preserve headless mode

**Files:**
- Modify: `scripts/run-mcp.mjs`
- Modify: `src/mcp/create-serpent-mcp-server.ts`
- Modify: `src/mcp/tool-catalog.ts`
- Modify: `src/mcp/call-tool.ts`
- Modify: `src/main/automation-mcp-bootstrap.ts`
- Modify: `src/main/automation-mcp-host.ts`
- Create: `src/mcp/desktop-control-tool-catalog.ts`
- Test: `tests/unit/desktop-control-mcp.test.ts`
- Test: `tests/e2e/automation-mcp-attached-desktop.test.ts`

**Interfaces:**
- Default launcher behavior: probe and attach to an existing Desktop; if absent, launch a visible Desktop and attach; explicit `--headless` keeps the existing process-local host.
- New attached-only tools:
  - `serpent_desktop_focus`
  - `serpent_desktop_select_assets({ assetIds, mode })`
- `tools/list` must not expose attached-only tools in headless mode.
- Domain tool names and schemas remain Registry-generated.

- [ ] **Step 1: Write catalog and launcher tests**

Test attached-only exposure, headless exclusion, `--headless` argument handling, visible GUI fallback, and stable errors for unavailable/denied attachment.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run tests/unit/desktop-control-mcp.test.ts`

Expected: FAIL because attached tool catalog and launcher mode do not exist.

- [ ] **Step 3: Implement the attached proxy path**

Keep stdio as the Agent-facing transport. The launcher owns probe/attach/GUI fallback and forwards frames to the Desktop control plane. Do not add a second MCP transport inside Desktop.

- [ ] **Step 4: Implement Focus and Selection tool calls**

`serpent_desktop_focus` returns only `{ focused: boolean }` plus a stable public reason on failure. `serpent_desktop_select_assets` returns the bound `libraryId`, mode, selected IDs, primary ID, and ignored IDs; it never returns filesystem paths.

- [ ] **Step 5: Run existing and new MCP tests**

Run: `npx vitest run tests/unit/desktop-control-mcp.test.ts tests/unit/serpent-mcp-adapter.test.ts tests/unit/automation-mcp-host.test.ts`

Expected: PASS.

- [ ] **Step 6: Add attached stdio E2E**

The E2E must start the real Desktop and MCP proxy with isolated userData, attach to the existing Desktop, pass local confirmation, call `serpent_desktop_focus`, call `serpent_desktop_select_assets`, and verify the same Renderer shows the selected cards. It must also verify that:

- `--headless` still works;
- headless `tools/list` omits Desktop-only tools;
- attached domain writes appear in the open UI;
- closing Desktop terminates the attached session;
- denial causes no write or selection side effect.

Run: `node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts`

### Task 6: Documentation, human acceptance, and final verification

**Files:**
- Modify: `docs/manual/scripts/development.md`
- Modify: `docs/skills/serpent-automation/SKILL.md`
- Modify: `docs/project-status.md`
- Modify: `docs/qa/human-acceptance-checklist.md`
- Create: `docs/development/2026-08-01-desktop-attached-selection-focus-development-log.md`
- Test: all focused tests from Tasks 1–5

- [ ] **Step 1: Document the boundary**

State that Focus and real Desktop Selection are attached-MCP-only UI controls; scripts and headless MCP cannot manipulate arbitrary UI state. Document attach confirmation, `--headless`, session lifetime, failure behavior, and the fact that selection is not a database write.

- [ ] **Step 2: Add human acceptance items**

Add separate checklist entries for:

- Agent attaches to an already open Desktop and focuses it;
- Agent selects search results and the open grid visibly highlights them;
- attached domain writes refresh the open Desktop;
- attachment denial and Desktop exit leave no unintended side effects;
- headless MCP remains available without Desktop UI.

Keep them `待人类验收`; automated tests do not change that status.

- [ ] **Step 3: Record development evidence**

Record the implementation base, commands, test results, known platform limitations, and any UI states that still require Computer Use. Do not claim packaged or Windows verification without current evidence.

- [ ] **Step 4: Run focused quality gates**

Run:

```bash
npx vitest run \
  tests/unit/desktop-control.test.ts \
  tests/unit/desktop-automation-selection.test.ts \
  tests/unit/desktop-window-control.test.ts \
  tests/unit/desktop-control-plane.test.ts \
  tests/unit/desktop-attach-session.test.ts \
  tests/unit/desktop-control-mcp.test.ts
node scripts/run-e2e.mjs tests/e2e/automation-desktop-selection.test.ts
node scripts/run-e2e.mjs tests/e2e/automation-desktop-focus.test.ts
node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts
npm run typecheck
npm run lint
```

Expected: all targeted tests, typecheck, and lint pass. Any packaged, Windows, or Computer Use result not executed must remain explicitly unverified.

- [ ] **Step 5: Run the mainline gate after the cross-process change**

Run: `npm run verify:mainline`

Expected: the final merged working tree passes or the development log records the exact blocker and returns the feature to `fixing`.
