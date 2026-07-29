# 2026-07-29：Automation Execution 日志与能力授权 QA（Serpent-y51c.6）

> 状态：automated-verification
>
> 基线：`ca22b5c`（隔离 UtilityProcess Runtime）；当前为共享工作树增量，尚未提交。

## 范围

本报告只覆盖 Automation Execution journal、保存脚本/Console/MCP 的授权边界、命令审计与本地持久化。它不宣称正式 Desktop Console、真实脚本 Runtime、MCP server、资产写入或打包平台通过。

## 自动化计划

| 需求 | 自动化接缝 | 预期 |
| --- | --- | --- |
| Console 状态机/会话授权 | `create/validate/finishValidation/authorizeFromDesktop/endSession` | 未授权 execution 不可被 Gateway 解析；完整状态迁移可追溯；会话结束后取消。 |
| 保存脚本持久 grant | 文件型 journal 重启读回 | 仅同一 SHA-256、资源库和能力集合自动授权；任一变化要求重新授权。 |
| MCP 授权边界 | `authorizeFromDesktop` 的无 actor 输入与 persistence 矩阵 | MCP payload 没有可伪造的 Desktop actor；只允许 Main Desktop/TTY 发放连接会话 grant。 |
| 重启/隐私 | 文件型 journal + AppLogger | 活跃 execution 标记为中断失败；脚本正文/API Key/路径不进入 journal 或日志上下文；UUID 以外的 library/session 输入被拒绝。 |
| 关联日志定位 | Main → Preload → 诊断日志面板的 opaque execution/log ID filter | `executionId` 或 `logId` 只返回对应 execution 日志；带路径、空格或未知字段的过滤请求在桥接层拒绝，原始输入不写日志。 |
| 预算/取消/并发 | `resourceBudget`、deadline timer、Gateway `AbortSignal` 与 per-execution command slots | deadline 持久化；取消/超时不再派发尚未开始的命令，并中止等待中的 Gateway 请求；超过 `maxConcurrentCommands` 的命令在 Worker 前被拒绝。已进入领域命令的恢复语义仍留给写入切片。 |
| Gateway 审计 | Gateway + active journal + AppLogger fake/failure sink | 成功/失败命令计数与 `logId` 关联；审计不会成为领域结果的第二个失败源，审计持久化失败另写应用日志。结构化 `authorization`、`env` / `environment` 字段整体脱敏。 |

## 已执行

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/automation-execution-journal.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/script-sandbox-preview-runtime.test.ts tests/unit/script-sandbox-preview-controller.test.ts` | 5 files、48 tests 通过。 |
| `npx vitest run --config vitest.config.ts tests/unit/app-logger.test.ts tests/unit/automation-execution-journal.test.ts` | 2 files、21 tests 通过；覆盖五种 terminal status、关联 ID 精确筛选、IPC 过滤字段校验、Authorization 与 environment 结构化脱敏。 |
| `node scripts/run-e2e-isolated.mjs tests/e2e/automation-script-rating.test.ts` | 1 test 通过：真实 Electron 从脚本运行结果点击「查看此次运行日志」，按 Main 签发的 `logId` 显示 `automation.execution.completed`，且不混入只有 `executionId` 的 `automation.runtime.spawn` 诊断。macOS 单屏环境按脚本提示回退主显示器；使用隔离 `SERPENT_E2E_USER_DATA_PATH`。 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/automation-readonly-command-executor.test.ts` | 1 file、3 tests 通过。 |
| `npm run typecheck` | 通过。 |
| 定向 ESLint | 通过。 |
| `npx vite build --config vite.renderer.config.ts` | 通过；现有沙箱预览 Worker chunk-size 警告不阻塞本无 UI 的 execution journal。 |

## 全量回归尝试

`npm run test` 通过 Electron 包装器执行时，当前主线仍有 4 个不在本切片改动范围内的 Worker 失败：`thumbnails` 的启动队列优先级、`trash-relink` 的两条冲突恢复语义、`library-export-import` 的 artifact 导入保留。单独以同一 Electron 包装器运行这三个文件为 `138 passed / 4 failed / 2 skipped`。这不是本切片绿灯的替代；当前发布收口工单已记录这些既有红项，Automation 定向路径没有触及相应 Worker 代码。

## 尚未执行的用户验证

诊断日志面板现在可以输入 Automation Execution 或 log ID 筛选当前运行的相关记录；尚未做 Computer Use 视觉验证。后续 `Serpent-y51c.4` / `.9` 接入正式 Console 时，必须在同一功能提交补充授权对话框、执行历史、运行日志跳转、停止与窄窗状态的人类验收和真实 Electron 截图证据。

## 平台结论

| 平台 | 结论 |
| --- | --- |
| macOS 开发态 | 仅本地 Node/Electron Vitest 定向验证；无用户界面。 |
| macOS packaged | 未执行。 |
| Windows x64 | 未执行。 |
