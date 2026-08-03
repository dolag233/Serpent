# 2026-07-30：独立 UtilityProcess Script Runtime 与保存脚本接缝（Serpent-y51c.3/.4）

## 本次增量

Desktop Console 不再在 Renderer Web Worker 中执行用户脚本。每次已授权的 Execution 由 Main 创建一个短生命周期 Electron UtilityProcess，QuickJS 只在该子进程中执行；子进程通过严格的消息协议请求固定 Automation Gateway 命令。Renderer 只能得到终态结果、受限 console 输出和稳定错误码。

该改动不扩大脚本能力：仍不得访问 Node、文件、网络、环境变量、任意 IPC、SQL 或 Library Worker；脚本源在授权时绑定到 Execution，随后 `execute` IPC 不接受新的 source，因此不能在授权后替换代码。

本轮补入保存和打开 `.serpent.js` / `.serpent.ts` 的最小闭环。原生文件选择和读写只在 Main；Renderer 仅得到脚本文本、文件名和 Main 签发的 opaque `scriptId`，绝不得到绝对路径。`scriptId` 与 `WebContents` 和精确文本绑定，编辑后不能将任意新代码伪装成已保存脚本以继承持久授权。保存脚本的 grant 仍由 execution journal 以脚本哈希、资源库和能力集合精确匹配。

## 2026-08-04 增量：运行时启动失败收口

`ScriptRuntimeSupervisor` 现在也会处理 `UtilityProcess.fork()` 的同步抛错：记录安全诊断后返回稳定的 `RUNTIME_PROCESS_EXITED` 结果，不把原始进程错误直接抛入 Main 调用链。这样启动失败与子进程运行期退出使用同一错误契约，调用方可以统一结束 Execution 并展示可理解的错误。

本次仅修复启动故障域，未改变脚本能力边界或超时策略；macOS/Windows packaged、Windows 实机和 Computer Use 仍未验证，因此工单继续保持 `in_progress`。

## 2026-08-04 增量：Automation Host 错误码透传

补齐 `Serpent-8mmp`：`automation-script-ipc.ts` 不再把 Gateway 的所有 `AUTOMATION_*` 失败压成 `INTERNAL_ERROR`。新增共享的白名单错误 envelope，固定 Gateway 错误码与安全文案，同时允许既有 `PublicError` 的 `reason` 和 `currentEntityVersion` 继续透传。未知错误仍只返回 `INTERNAL_ERROR`。

运行时 supervisor 将该 envelope 原样发给 Script Utility；QuickJS 的 Host Promise 拒绝现在会创建带 `error.code`、`error.message`（以及可用时的 `reason` / `currentEntityVersion`）的 Guest Error。因此脚本可以按稳定错误码处理权限拒绝、参数错误、资源不存在和版本冲突，而不依赖文案或内部诊断。

定向验证：`automation-script-ipc.test.ts`、`script-runtime-supervisor.test.ts`、`script-runtime-utility.test.ts` 覆盖 Gateway 错误、IPC envelope 和脚本 `catch`；共 12 个测试通过。相关 Gateway、协议和 QuickJS 回归合计 142 个测试通过；typecheck 与定向 lint 通过。未执行 packaged/Windows/Computer Use。

2026-08-04 Electron 回归：在按环境约定将 `better-sqlite3` 重编译为 Electron ABI 后，`node scripts/run-e2e-isolated.mjs tests/e2e/automation-script-rating.test.ts` 与 `tests/e2e/automation-script-recent-list.test.ts` 各 1 passed。此前一次失败是本地 native module 仍为 Node ABI，资源库创建未完成，非产品断言失败；已修正测试环境并重新运行。

## 四列证据

| 需求 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 每次运行在可强制终止的独立进程 | `src/main/script-runtime-supervisor.ts`、`src/scripting/script-runtime-utility-entry.ts`、`forge.config.ts` | `script-runtime-supervisor.test.ts` 验证 ready、固定 host 命令代理、终态 kill、取消后忽略迟到消息 | 2026-07-30 macOS 隔离 Electron E2E（评分、批量重命名）均通过；Windows/packaged 未执行。 |
| 子进程只可调用声明过的 Gateway 命令 | `src/scripting/script-runtime-utility.ts`、`src/shared/script-runtime-utility-protocol.ts`、`automation-script-ipc.ts` | Utility handler 测试只产生 `asset.search` 等注册命令；IPC 测试验证执行时仍经 Main/Gateway、搜索语法转换与 journal 计数 | 两条 Electron E2E 在临时库真实执行，评分和改名均经现有授权/计划路径。 |
| 取消、超时、进程异常不会留下悬挂执行 | `ScriptRuntimeSupervisor`、`AutomationExecutionJournal`、`automation-script-ipc.ts` | Supervisor 取消测试、Utility 等待 host 的取消测试；journal 终态由 Main 收口 | Electron 评分/改名成功路径已验证；手动停止、崩溃和 packaged/Windows 仍待人类/平台验证。 |
| E2E 使用当前 UtilityProcess 产物 | `scripts/run-e2e.mjs` | 每次 E2E 同时构建 `script_runtime_utility.js`，避免复用旧产物 | 2026-07-30 执行两条实际 Electron 旅程。 |
| 保存/打开脚本不泄露路径且不放大授权 | `src/main/automation-script-file-service.ts`、`automation-script-ipc.ts`、`ScriptSandboxPreviewDialog.tsx` | `automation-script-file-service.test.ts` 验证扩展名/大小、sender/text 绑定；`automation-script-ipc.test.ts` 拒绝伪造或改写后的 handle | 2026-07-30 隔离 Electron E2E 保存 `rating.serpent.ts`、编辑后重新打开并执行通过；原生对话框与持久授权的人类观察仍待验。 |

## 事故与修复

初次 Electron E2E 暴露 UtilityProcess 的运行命令没有送达。根因是 Electron 的子进程 `process.parentPort.on('message')` 传入 `MessageEvent`，不是裸 payload；原实现没有读取 `event.data`，使消息被 schema 拒绝并在 ready timeout 后失败。现已在子进程显式取 `.data`，而 Main 对子进程回包也兼容规范化 `MessageEvent`。该修复由重新运行的真实评分和文件计划 E2E 覆盖。

## 本次命令与结果

```bash
npm run test:unit -- tests/unit/script-runtime-utility.test.ts tests/unit/script-runtime-supervisor.test.ts tests/unit/automation-script-ipc.test.ts
npm run typecheck
npm run lint
node scripts/run-e2e-isolated.mjs tests/e2e/automation-script-rating.test.ts
node scripts/run-e2e-isolated.mjs tests/e2e/automation-script-file-operations.test.ts
```

2026-07-30 第一轮结果：Unit 208 files、1632 passed、1 skipped；typecheck/lint 通过；评分和文件操作 Electron E2E 均各 1 passed。

保存/打开增量定向验证：

```bash
npx vitest run --config vitest.config.ts tests/unit/automation-script-file-service.test.ts tests/unit/automation-script-ipc.test.ts
node scripts/run-e2e-isolated.mjs tests/e2e/automation-script-rating.test.ts
```

2026-07-30 结果：25 个定向单测通过；评分 Electron E2E 1 passed，测试实际保存脚本、修改编辑器文本、重新打开并验证恢复内容，再执行默认评分脚本和运行日志筛选。

2026-08-04 启动失败回归验证：

```bash
npx vitest run --config vitest.config.ts tests/unit/script-runtime-supervisor.test.ts tests/unit/script-runtime-utility.test.ts tests/unit/quickjs-sandbox-prototype.test.ts
npx eslint src/main/script-runtime-supervisor.ts tests/unit/script-runtime-supervisor.test.ts
npm run typecheck
```

结果：3 个单测文件、26 个测试通过；定向 lint 与 typecheck 通过。

## 未验证/未完成

- macOS packaged、Windows packaged 和 Windows 实机尚未验证，不能据此关闭跨平台打包门禁。
- 当前 Console 已包含保存/打开脚本；仍不包含独立类型文件、模块式脚本入口、source-map 栈回映、执行历史 UI 或 MCP transport。
- 因终端没有第二显示器，隔离 E2E 会按现有机制回退主显示器；它是自动化行为证据，不是 Computer Use 视觉验收。AUT-006 保持待人类验收。
