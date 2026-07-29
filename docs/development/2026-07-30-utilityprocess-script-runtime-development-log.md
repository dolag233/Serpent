# 2026-07-30：独立 UtilityProcess Script Runtime（Serpent-y51c.3）

## 本次增量

Desktop Console 不再在 Renderer Web Worker 中执行用户脚本。每次已授权的 Execution 由 Main 创建一个短生命周期 Electron UtilityProcess，QuickJS 只在该子进程中执行；子进程通过严格的消息协议请求固定 Automation Gateway 命令。Renderer 只能得到终态结果、受限 console 输出和稳定错误码。

该改动不扩大脚本能力：仍不得访问 Node、文件、网络、环境变量、任意 IPC、SQL 或 Library Worker；脚本源在授权时绑定到 Execution，随后 `execute` IPC 不接受新的 source，因此不能在授权后替换代码。

## 四列证据

| 需求 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 每次运行在可强制终止的独立进程 | `src/main/script-runtime-supervisor.ts`、`src/scripting/script-runtime-utility-entry.ts`、`forge.config.ts` | `script-runtime-supervisor.test.ts` 验证 ready、固定 host 命令代理、终态 kill、取消后忽略迟到消息 | 2026-07-30 macOS 隔离 Electron E2E（评分、批量重命名）均通过；Windows/packaged 未执行。 |
| 子进程只可调用声明过的 Gateway 命令 | `src/scripting/script-runtime-utility.ts`、`src/shared/script-runtime-utility-protocol.ts`、`automation-script-ipc.ts` | Utility handler 测试只产生 `asset.search` 等注册命令；IPC 测试验证执行时仍经 Main/Gateway、搜索语法转换与 journal 计数 | 两条 Electron E2E 在临时库真实执行，评分和改名均经现有授权/计划路径。 |
| 取消、超时、进程异常不会留下悬挂执行 | `ScriptRuntimeSupervisor`、`AutomationExecutionJournal`、`automation-script-ipc.ts` | Supervisor 取消测试、Utility 等待 host 的取消测试；journal 终态由 Main 收口 | Electron 评分/改名成功路径已验证；手动停止、崩溃和 packaged/Windows 仍待人类/平台验证。 |
| E2E 使用当前 UtilityProcess 产物 | `scripts/run-e2e.mjs` | 每次 E2E 同时构建 `script_runtime_utility.js`，避免复用旧产物 | 2026-07-30 执行两条实际 Electron 旅程。 |

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

2026-07-30 结果：Unit 208 files、1632 passed、1 skipped；typecheck/lint 通过；上述两个 Electron E2E 均各 1 passed。

## 未验证/未完成

- macOS packaged、Windows packaged 和 Windows 实机尚未验证，不能据此关闭跨平台打包门禁。
- 当前 Console 仍不包含保存/打开脚本、类型文件、source-map 栈回映、执行历史 UI 或 MCP transport。
- 因终端没有第二显示器，隔离 E2E 会按现有机制回退主显示器；它是自动化行为证据，不是 Computer Use 视觉验收。AUT-006 保持待人类验收。
