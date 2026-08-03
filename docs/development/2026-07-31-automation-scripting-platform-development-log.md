# 2026-07-31 自动化脚本平台开发日志

> 规格：`docs/implementation/0023-automation-scripting-mcp-framework.md`
> 设计：`docs/superpowers/specs/2026-07-31-automation-scripting-platform-design.md`
> 计划：`docs/superpowers/plans/2026-07-31-automation-scripting-platform.md`
> 主工单：`Serpent-y51c.8`；`Serpent-bb56.2` 已关闭；后续 `Serpent-y51c.9`、`Serpent-y51c.10`

## 状态

- 开始时间：2026-07-31
- 当前状态：implementing
- 当前阶段：Task 6 Console Undo Group 与最近脚本列表已实现，Computer Use/packaged 仍未完成
- 产品确认：脚本主线完成边界为 0023 Phase A–F；插件 UI/Hook/Provider/Input Capture 暂停扩展。
- 产品确认：Undo 需要以 `undo group` 为边界，未来用户操作（包括移入回收站）可通过 `Ctrl/Cmd+Z` 撤销；当前先建立共享领域语义，快捷键接入留在 Console 收口阶段。
- 产品确认：headless Execution 可以无当前资源库启动，但除 `library.create` 外，后续操作必须在资源库成功创建、打开/初始化并显式绑定后执行。

## 已完成增量

### Task 1：未绑定 headless Execution 的公共契约

- `AutomationExecutionContext.libraryId` 允许 `null`，表示 headless Execution 尚未绑定资源库。
- `AutomationExecutionJournal` 可以创建并授权未绑定 Execution。
- Main 可在资源库实际打开/初始化后调用 `bindLibrary`；已绑定 Execution 不允许再次绑定。
- Gateway 在当前 Action 尚未支持 `library.create` 的阶段，对未绑定资源库的库级命令 fail closed，返回 `AUTOMATION_LIBRARY_NOT_BOUND`，且不向 Worker 派发请求。
- `0023`、领域术语表和脚本平台设计文档已记录 Undo Group 与 headless 打开/绑定前置条件。

### Task 3：Phase E 建库与导入计划

- Registry 已加入 `library.create`、`file.import`，两者均为 `file-write + plan`，由 Main 统一批准。
- `library.create` 仅允许 desktop-console/script/mcp/test；创建成功后 Main 验证 Worker 中已打开的库并调用 Journal `bindLibrary`，绑定失败不会返回成功。
- `file.import` 先经 Worker readonly `automation.file-import-plan` 计算文件数量、字节数、冲突数、变更序列和源文件状态令牌；计划预览返回给 Main，脚本/MCP 不会收到计划内部令牌或 Worker 的绝对路径。
- 导入执行携带 Main 生成的源状态 proof；Worker 在 staging 前重新计算变更序列和源状态，发现源文件或库状态变化时返回 `VERSION_CONFLICT`，不创建导入操作目录。
- MCP write grant 现在暴露 plan-gated tools；未授权连接不暴露建库/导入/文件计划工具。脚本可在 `libraryId: null` 下启动，但除 `library.create` 外的库级命令仍由 Gateway 拒绝。

### Task 6：Desktop Console headless 状态反馈

- Console 的 Main-owned `start` 结果现在携带本次执行声明的能力集合，Renderer 展示能力摘要，不从 Renderer 推断授权。
- 无库状态明确提示只能先执行 `library.create`；资源库绑定状态明确提示后续 Action 仍受 Gateway 与本机批准保护。
- `library.create` 成功绑定后，Main 同步记录最近资源库并发布 `library.opened` 生命周期事件，使 Desktop Console 的创建/打开/绑定结果进入正常应用状态，而不是只绑定单次 Execution。

### Task 4：Undo Group 恢复引用接缝

- Worker 的 `asset.trash` 结果现在返回已持久化 `file_operations.operation_id`；Gateway 在提供 Undo Group handler 时，将该恢复引用作为可撤销 item 记录并完成 group。
- 没有恢复引用的成功命令会记录为 `partially-succeeded`，不会伪装成完整可撤销；实际文件恢复和 `Ctrl/Cmd+Z` 入口仍未在本增量中实现。
- 主进程已将 Execution Journal 作为 Gateway 的 Undo Group handler，脚本结果和 MCP 结果携带 `undoGroupId`。
- `file.import` 在导入恢复引用落地前改为 `supportsUndo: false`，避免无 `operationId` 时持续产生伪成功/半成功 Undo Group。
- Main 的 Undo Group handler 在 journal 缺失或 append/complete 找不到 group 时抛错；Gateway 对最终化失败记审计并返回 `INTERNAL_ERROR`，不再静默丢弃。

### Task 6：应用级 Undo 入口

- 新增 `automation:script-undo` IPC；Renderer 只提交 `executionId` 或显式 `undoGroupId`，不接收路径、manifest 或 Worker 回滚细节。
- Main 按执行归属和 Journal 中最新可撤销组执行恢复；移动复用 `asset.move-undo`，回收站复用现有 `restoreAssetsIfOriginalVacant`，并将已应用组标记为不可再次撤销。
- Console 完成态显示可撤销按钮；非文本输入焦点下支持 Ctrl/Cmd+Z，文本框内保留浏览器编辑撤销。缺失、已消费和文件已变化分别返回稳定公开错误。
- 当前 Registry 事实：`asset.move` 与 `asset.trash` 有恢复引用；`asset.rename-file`/`asset.rename-files` 无 operation ID，因此仍不可撤销。

### Standards 审查高/中项收口

- 媒体 Job 在 lease 丢失时将 `running` 重新置回 `queued`（`JOB_LEASE_LOST`），避免卡死到重启。
- Worker `library.changed` 经独立 `LIBRARY_CHANGED_CHANNEL` 转发到 Renderer；不再伪造 `asset.changed` 计数。
- Gateway：缺 binding handler 返回 `INTERNAL_ERROR`；未绑定库却要求 Undo 返回 `AUTOMATION_LIBRARY_NOT_BOUND`。

### Task 2：change-sequence 拉取与 fencing 集成证据

- Worker 协议新增只读 `library.change-sequence`；automation-readonly 与 desktop 分发均不占 write lease。
- 新增 `tests/worker/automation-write-fencing.test.ts`：跨 `LibraryService` 实例验证 `library.changed`、lease busy、过期 renew 拒绝。
- Registry/Gateway/MCP/脚本宿主已映射 `library.change-sequence`（`serpent.library.changeSequence()` / `serpent_library_change_sequence`）。
- import applying 已接 Job lease fencing；managed-move / managed-move-undo 同步接 lease；copy/restore applying 仍未完成。`Serpent-bb56.2` 的 fencing、MCP 推送和迁移时序证据已在工单关闭前完成。

## 验证证据

2026-07-31 执行：

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/automation-command-gateway.test.ts \
  tests/unit/automation-execution-journal.test.ts \
  tests/unit/automation-script-ipc.test.ts
```

结果：3 个测试文件、45 个测试通过。先运行失败测试确认了两个预期缺口：未绑定库的 Gateway 请求错误地继续执行；Journal 拒绝 `null` libraryId。修复后定向回归通过。

追加执行：

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/automation-mcp-bootstrap.test.ts \
  tests/unit/serpent-mcp-adapter.test.ts \
  tests/unit/automation-script-ipc.test.ts \
  tests/unit/automation-execution-journal.test.ts \
  tests/unit/automation-command-gateway.test.ts \
  tests/unit/automation-file-plan-approval.test.ts \
  tests/worker/import-planning.test.ts
```

结果：7 个测试文件、98 个测试通过。另行执行 `tests/unit/plugin-contract.test.ts` 与同一导入回归集合，4 个测试文件、61 个测试通过。

```text
npx tsc --noEmit --pretty false
```

结果：通过（exit code 0）。`ReadLints`：受影响文件无 linter errors。

```text
ReadLints:
No linter errors found
```

本次会话追加执行 `npx vitest run` 的 5 个脚本单元测试文件，结果为 5 个文件、72 个测试通过；`npm run lint && npm run typecheck` 结果为通过。直接用 Node 运行 `tests/worker/import-planning.test.ts` 时因当前 `better-sqlite3` 为 Electron ABI（148），而 Node 需要 ABI 137，未形成有效的 Worker 回归证据；Electron ABI 恢复命令本身的 FTS5 probe 通过。

本轮性能回归：

```text
SERPENT_SOAK_ASSET_COUNT=5000 node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/library-import-export-soak.test.ts
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/library-import-export-soak.test.ts
```

结果：两个命令均为 1 个测试文件、3 个测试通过；5000 资产用时 12.65 秒，默认 20000 资产用时 53.07 秒。新增 schema v26 为缩略图队列的 `jobs(asset_id, kind, status)` 和 artifact 查询建立复合索引，20k 导入已低于原 60 秒门槛。

Undo 恢复引用回归：4 个测试文件、128 个测试通过、1 个跳过。

自动化 Electron E2E：

```text
node scripts/run-e2e.mjs tests/e2e/automation-script-rating.test.ts tests/e2e/automation-script-file-operations.test.ts
```

结果：2 个测试通过。首次运行因运行日志按钮存在历史列表项和底部快捷项造成严格定位器冲突，已改为选择最后一个按钮后重跑通过。

### Phase E E2E：Desktop Console headless 建库与导入

新增 `tests/e2e/automation-script-library-create-import.test.ts`。当前 Desktop Console 在无库状态被创建资源库模态遮挡，因此测试先通过正常 UI 创建空库，再在已绑定 Console 执行 `library.inspect` → `files.import`：

- `SERPENT_E2E_AUTOMATION_CONFIRM=1` 只作为隔离、未打包 E2E 的 Main 计划批准接缝；脚本不接收计划内部令牌或绝对路径。
- 结果区和对话框均断言不包含隔离临时根路径；导入后的真实资产卡片与完成通知证明 Worker 已完成导入。
- 使用同一显式 `SERPENT_E2E_USER_DATA_PATH` 完整关闭 Electron，再次启动并断言最近资源库及导入资产恢复。
- 当前 E2E 未覆盖“取消一次计划后重试”：确定性 E2E 接缝会自动批准计划，取消需交互式 native modal 或独立可控的测试 seam；Console 无库 headless `library.create` 与真实 MCP stdio 旅程仍是后续缺口。

执行命令：

```text
node scripts/run-e2e.mjs tests/e2e/automation-script-library-create-import.test.ts
```

结果：`1 passed (19.3s)`。取消计划、Console 无库 headless `library.create`、真实 MCP stdio 旅程、Computer Use、packaged/Windows 仍未验证。

## 当前未完成

- Undo Group 已接入移动/回收站的 Worker 恢复执行器和应用级 `Ctrl/Cmd+Z`；真实撤销旅程仍待主 agent/人类验证。
- `file.import` 仍无可撤销恢复引用；`supportsUndo` 暂为 false。
- `Serpent-bb56.2` 已关闭；真实双 MCP Host 推送旅程与人类验收仍保留。
- Desktop Console headless 建库/打开绑定/导入的开发态 Electron E2E 已补；取消计划、真实 MCP 写入旅程、packaged/Windows/Computer Use 均未验证。
- Console 当前仍是单脚本编辑/运行入口；最近脚本列表已补，取消后的历史刷新和完整计划审批 UI 尚未收口。

`npm run verify:mainline` 本轮完成了 lint、typecheck、extension verify、全量 Worker/unit（264 files passed、2425 tests passed）和 search perf（5 tests passed）；核心 Electron E2E 结果为 39 passed、29 failed、1 skipped，耗时 14.4 分钟。失败集中在已有的多窗口/焦点、分页、偏好恢复、桌面导入、选择框选、媒体播放和组织回归，不能将主线标记为通过；脚本相关的两个定向 E2E 已单独通过。

审查修复追加验证（2026-07-31）：

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/automation-command-gateway.test.ts
```

结果：1 个测试文件、29 个测试通过。

### 2026-07-31 Task 6 Undo 增量验证

```text
npm run typecheck
npx vitest run tests/unit/automation-undo-shortcut.test.ts tests/unit/automation-script-ipc.test.ts
npx eslint src/main/automation-script-ipc.ts src/main/automation-execution-journal.ts src/main/index.ts src/preload/index.ts src/renderer/ScriptSandboxPreviewDialog.tsx src/shared/automation-script-api.ts src/shared/protocol/channels.ts src/shared/protocol/errors.ts src/shared/protocol/requests.ts src/shared/protocol/responses.ts src/worker/index.ts src/worker/library-service.ts tests/unit/automation-undo-shortcut.test.ts
```

结果：类型检查通过；聚焦 IPC 测试 2 个文件、5 个测试通过；受影响文件 lint 通过。真实 Electron 撤销、Computer Use、packaged/Windows 尚未执行。

追加 Electron E2E（2026-07-31）：

```text
node scripts/run-e2e.mjs tests/e2e/automation-script-file-operations.test.ts
```

结果：3 tests passed（rename、移动、移动后撤销；36.3s）。新增用例创建隔离资源库、导入单项资产和目标文件夹，通过 `SERPENT_E2E_AUTOMATION_CONFIRM=1` 执行 `moveToFolder`，断言 Console 显示“本次运行支持撤销”和“撤销自动化操作”，点击按钮后同时对账资产回到 `Assets/` 根目录、目标目录不再存在该文件，结果区域不含临时绝对路径。首次复跑仅因测试收尾按钮未使用 `exact: true` 触发严格定位失败，修正后通过；该失败不属于产品行为失败。

## 2026-07-31 追加：计划确认的 asset.move（Serpent-7v2i）

### 实现

- Registry `asset.move`（能力 `file.move`，`approvalPolicy: plan`，MCP `serpent_asset_move`）。
- 扩展 `automation.file-operation-plan` operation=`move`；Worker `previewAutomationFileOperation` + `asset.move` 校验 `automationPlan`。
- 脚本 `serpent.assets.moveToFolder`；Console / MCP 写会话授予 `file.move`（并补齐既有 trash/rename/clipboard 写能力）。
- 人类验收 `AUT-011`。

### 验证

```text
npx vitest run tests/unit/automation-command-gateway.test.ts \
  tests/unit/automation-file-plan-approval.test.ts \
  tests/unit/serpent-mcp-adapter.test.ts \
  tests/unit/plugin-contract.test.ts
```

结果：4 files、64 tests 通过。

## 2026-07-31 追加：Phase E 计划取消与资产移动 E2E

### 实现

- Main 增加仅限未打包隔离 E2E 的 `SERPENT_E2E_AUTOMATION_CANCEL_ONCE=1` 接缝：首次文件计划拒绝，后续计划继续使用 `SERPENT_E2E_AUTOMATION_CONFIRM=1` 自动批准；普通运行和打包应用不启用。
- 新增导入取消后重试 E2E：确认首次取消不产生资产，第二次相同脚本导入成功，并保留结果无绝对路径与完整既有重启覆盖。
- 新增 `asset.move` Desktop Console E2E：计划批准后检查 `Assets/目标文件夹/` 的物理文件、根目录无旧文件、目标文件夹视图可见资产，结果不暴露临时根路径。

### 验证

```text
node scripts/run-e2e.mjs \
  tests/e2e/automation-script-library-create-import.test.ts \
  tests/e2e/automation-script-file-operations.test.ts
```

结果：4 tests passed（既有 rename、建库/导入/重启，加上计划取消重试与 asset.move）。

### 保留范围

- `Serpent-y51c.8` 保持 `in_progress`；Computer Use、packaged/Windows 仍未验证。

## 2026-07-31 追加：真实 MCP stdio headless 建库/导入

### 实现

- 新增 `tests/e2e/automation-mcp-library-create.test.ts`，使用 MCP SDK `StdioClientTransport` 的 pipe stdin/stdout，直接启动当前构建的 Electron Main，而不是 `InMemoryTransport` 或 `electron-forge` 日志转发。
- 每次旅程使用唯一临时根目录、独立 `SERPENT_MCP_USER_DATA_PATH`，并设置 `SERPENT_MCP=1`、`--unbound` 等价环境和 `SERPENT_MCP_WRITE_ACCESS=1`。
- 通过真实 MCP SDK Client 执行 `tools/list`、`serpent_library_create`、`serpent_library_inspect`、`serpent_file_import`；计划使用仅限未打包隔离 E2E 的 `SERPENT_E2E_AUTOMATION_CONFIRM=1` 自动批准。
- 断言 create、inspect、import 的工具结果均不含临时根绝对路径；关闭第一进程后，以创建出的库路径启动第二个绑定 MCP Host，再次 inspect，覆盖完整 Main/Worker 退出与重开。

### 验证

```text
node scripts/run-e2e.mjs tests/e2e/automation-mcp-library-create.test.ts
```

结果：最终复跑 `1 passed (21.6s)`。首轮因测试遗漏 `SERPENT_E2E=1`，计划确认进入不可见 native dialog，已停止并修正；该首轮未作为通过证据。修正后的测试通过真实 pipe stdio 完成 create/inspect/import、关闭第一 Host 后绑定重开 inspect，工具结果均未包含临时根路径。

### 保留范围

- `Serpent-y51c.8` 保持 `in_progress`；真实 MCP headless 建库缺口已补证，Console 无库 headless UI 仍未执行。
- Computer Use、packaged/Windows 仍未执行；真实 MCP `library.changed` 推送、超时/幂等重试仍按 AUT-012/AUT-013 独立验收。

## 2026-07-31 追加：真实 MCP `library.changed` 推送 E2E

### 实现

- 新增 `tests/e2e/automation-mcp-library-changed.test.ts`，使用 MCP SDK `Client` + `StdioClientTransport` 启动真实 Electron Main/MCP Host。
- E2E 在同一隔离、未绑定 MCP 会话中执行 `library.create` 后自动绑定新库，读取初始 `library.change-sequence`，注册标准 `LoggingMessageNotificationSchema` 处理器，再执行 `tag.create` 触发真实 Worker 变更。
- 断言收到 `notifications/message` 的 `data.type = "library.changed"`，`libraryId` 与当前绑定库匹配，`changeSequence` 不小于写入前序号，且通知与工具结果不含临时根目录绝对路径。

### 验证

```text
node scripts/run-e2e.mjs tests/e2e/automation-mcp-library-changed.test.ts
```

结果：后台真实 Electron/MCP 运行 `1 passed (8.3s)`；Vite 构建完成，未运行 `npm run package` 或 `media:verify`。`npx eslint tests/e2e/automation-mcp-library-changed.test.ts && npm run typecheck` 通过。

### 保留范围

- AUT-013 已从“暂不可验收”移至“待人类验收”；未绑定/不同库过滤的独立真实旅程、Computer Use、packaged/Windows 仍未执行。
- `Serpent-y51c.9`、`Serpent-y51c.10` 保持开放。

## 2026-07-31 追加：未绑定/不同库过滤与双 Host E2E

### 实现

- 新增 `tests/e2e/automation-mcp-dual-host.test.ts`，复用真实 Electron + MCP SDK `Client`/`StdioClientTransport`，为每个 Host 分配独立临时 `userData`。
- 过滤用例先建立两个独立资源库，再同时启动未绑定 Host、绑定库 A Host 和绑定库 B Host；库 B 执行 `tag.create` 后，断言未绑定 Host 与库 A Host 均不会收到库 B 的 `library.changed`，并检查通知/工具结果不含临时根路径。
- 双 Host 用例同时绑定同一资源库，并发执行 `tools/list`、`serpent_library_inspect` 和两个标签写入；写入结果允许一个成功、另一个返回 `LIBRARY_BUSY`，以验证写租约边界而非依赖固定调度顺序。

### 验证

```text
node scripts/run-e2e.mjs tests/e2e/automation-mcp-dual-host.test.ts
npx eslint tests/e2e/automation-mcp-dual-host.test.ts
npm run typecheck
```

结果：后台真实 Electron/MCP 运行 `2 passed (48.3s)`；过滤用例和双 Host 用例均通过。`npx eslint tests/e2e/automation-mcp-dual-host.test.ts && npm run typecheck` 通过。未运行 `npm run package` 或 `media:verify`。

### 保留范围

- AUT-013 的真实绑定推送、未绑定过滤、不同资源库过滤均有开发态 stdio E2E 证据，仍需人类操作验收。
- 新增 AUT-017 追踪双 Host 人类验收；Computer Use、packaged/Windows 仍未执行。
- `Serpent-y51c.8` 保持 `in_progress`；`Serpent-y51c.9`、`Serpent-y51c.10` 保持开放。

## 2026-07-31 追加：Console 无库入口与绑定状态 E2E

### 实现

- 无库欢迎态曾提供从创建资源库模态直接打开“自动化脚本”的入口；该入口已按产品反馈撤回，脚本入口保留在已有资源库的“更多工具”中。
- Renderer 订阅 Main 发布的 `library.opened` 生命周期事件。无库 Console 执行 `library.create` 成功后，应用切换到新库、刷新根范围、更新最近库和活动上下文。
- Console 继续显示 Main 返回的未绑定提示与本次执行能力集合；脚本结果只呈现脱敏领域结果，不包含 E2E 临时根路径。
- 中英文目录沿用 `automation.preview.open` 文案，未新增硬编码 UI 文案。

### 验证

```text
node scripts/run-e2e.mjs tests/e2e/automation-script-console.test.ts
```

结果：`1 passed (12.4s)`。覆盖隔离无库启动、欢迎态进入 Console、未绑定提示、能力摘要、`library.create` 后应用绑定/浏览状态以及结果无临时绝对路径。

### 保留范围

- `Serpent-y51c.9` 仍保持 `in_progress`：Computer Use、packaged/Windows 等范围仍按各自验收项保留。

## Console 最近脚本列表（2026-07-31）

### 已完成

- Main 新增 `automation-recent-scripts.json`（userData，最多 12 条），仅存
  `handle`/`displayName`/`absolutePath`/`lastOpenedAt`；Renderer 通过
  `automation.recentList()` / `automation.openRecent()` 只收到 handle、文件名与时间戳。
- `AutomationScriptFileService` 在打开/保存成功后写入最近列表；`openRecent` 由 Main
  读盘并签发新的 `scriptId` 绑定。
- Console 对话框新增「最近脚本」区；编辑内容仍会清除 saved-script 授权。
- 中英文 i18n、聚焦单测与 AUT-016 人类验收项已同步。

### 验证

```text
npx vitest run tests/unit/automation-recent-scripts-store.test.ts tests/unit/automation-script-file-service.test.ts tests/unit/automation-script-ipc.test.ts
node scripts/run-e2e.mjs tests/e2e/automation-script-recent-list.test.ts
```

结果：12 passed；`automation-script-recent-list` E2E `1 passed (18.0s)`，覆盖保存后进最近列表、关闭 Console、重开并从列表恢复脚本且 UI 无绝对路径。

### 保留范围

- `Serpent-y51c.9` 仍保持 `in_progress`：Computer Use、packaged/Windows 尚未完成。

## 重要入口

- Registry/Gateway：`src/automation/command-registry.ts`、`src/automation/command-gateway.ts`
- Execution journal：`src/main/automation-execution-journal.ts`
- 计划批准：`src/main/automation-file-plan-approval.ts`
- Worker 写协调：`src/worker/library-write-coordinator.ts`
- Console IPC：`src/main/automation-script-ipc.ts`
- 最近脚本存储：`src/main/automation-recent-scripts-store.ts`

## Phase F：打包断言、声明与 MCP 启动器（2026-07-31）

### 已完成

- `scripts/verify-package.mjs` 现在同时校验 Script Runtime / Plugin Host ASAR
  条目、Main 入口、Registry 的 `AUTOMATION_API_VERSION`、Registry command ID
  与 `docs/skills/serpent-automation/automation-api.d.ts` 的一致性，以及协议专用
  `npm run mcp` 启动器和仓库内 Skill/指南资源。
- 新增 `automation-api.d.ts`，覆盖当前 Registry 的公开 command ID、headless
  `library.create` / `file.import`、分页查询、计划确认、移动/撤销相关声明。
- Skill 与指南补充 Undo Group 的部分成功语义、MCP 状态/幂等重试、stdio 启动器边界
  和声明文件位置；新增人类验收项 AUT-015，状态保持“待人类验收”。

### 自动化验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/media-binaries.test.ts
```

结果：`12 passed`；覆盖 packaged fixture 的 ASAR Host/Script Runtime、Main 入口、
声明/API 版本和媒体资源验证。`npm run typecheck` 与本轮 ESLint 通过。

### 打包限制

```text
npm run package
```

结果：未开始 Forge 打包。既有 `media:verify` 门禁拒绝当前 darwin-arm64 bundle，
原因是没有晋升到不可变 HTTPS 来源的 release artifact。未使用旧 `.app` 证明当前
HEAD；因此 packaged smoke、Computer Use 和 Windows 均保持未验证。随后已执行
`npm run rebuild:native`，以恢复开发态 native ABI。

## AUT-012：真实 MCP 状态查询与幂等重试 E2E（2026-07-31）

### 实现

- 新增 `tests/e2e/automation-mcp-idempotency.test.ts`，使用隔离临时 `userData`、未绑定且已授予写权限的真实 Electron MCP stdio Host，并设置 `SERPENT_E2E_AUTOMATION_CONFIRM=1`。
- 同一 MCP execution 调用 `serpent_library_create` 后调用 `serpent_execution_status`，断言执行 ID、状态、命令计数和成功/失败计数字段存在；结果不包含临时绝对路径。
- 使用相同 `idempotencyKey` 与完全相同参数重试，断言返回同一 `libraryId`/结果且磁盘仅有一个资源库；使用相同 key 修改 `displayName`，断言返回 `AUTOMATION_INVALID_REQUEST`。
- 修正 Gateway 顺序：`library.create` 成功后会绑定新库，同 execution 的同 key 重试必须先命中幂等结果；新 key 或参数冲突仍拒绝已绑定 execution 的再次建库。

### 验证

```text
npx vitest run tests/unit/automation-command-gateway.test.ts tests/unit/serpent-mcp-adapter.test.ts
npx eslint tests/e2e/automation-mcp-idempotency.test.ts src/automation/command-gateway.ts
npm run typecheck
node scripts/run-e2e.mjs tests/e2e/automation-mcp-idempotency.test.ts
```

结果：Gateway/MCP 单测 `46 passed`，ESLint 与 typecheck 通过；真实 Electron/MCP E2E 后台运行 `1 passed (6.0s)`。本轮未模拟中途客户端超时，使用完成态 `serpent_execution_status` 验证轮询接缝，避免引入不稳定 sleep；未运行 `npm run package`。

### 保留范围

- AUT-012 已具备真实 MCP 开发态 E2E 证据并进入“待人类验收”；客户端中途超时、Computer Use、packaged/Windows 仍未执行。
- `Serpent-3d32` 保持 closed；`Serpent-y51c.8` 保持 in_progress；`Serpent-y51c.9`、`Serpent-y51c.10` 保持开放。
