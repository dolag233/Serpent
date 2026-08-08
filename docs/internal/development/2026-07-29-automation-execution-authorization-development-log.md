# 2026-07-29：Automation Execution 日志与能力授权（Serpent-y51c.6）

> 状态：automated-verification（Execution journal 已被真实 UtilityProcess Console 消费；尚待 packaged/Windows 与正式自动化中心）
>
> 基线：`ca22b5c`（每次运行一个 Main 监督的 QuickJS UtilityProcess）
>
> 规格：[0023 脚本自动化与 MCP](../implementation/0023-automation-scripting-mcp-framework.md)，决策：[ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)。

## 目标

为后续 Desktop Console、受控脚本与 MCP 建立 Main-owned `Automation Execution` 基础：单库绑定、脚本内容哈希、能力授权、状态机、取消/终止、命令审计、脱敏日志引用和应用重启恢复。

本切片不自行定义脚本能力或文件写入语义；现有受限 Console 通过它创建、授权、审计和收口 execution，再由 Gateway 和领域命令决定可执行范围。保存脚本、MCP、完整执行历史和打包平台仍不在本增量范围。

## 预先确定的测试接缝

1. `AutomationExecutionJournal` 的公开创建、授权、解析、终止、完成和重启恢复接口。
2. `Automation Command Gateway` 调用后的公开审计结果；审计写失败不得改变命令结果。
3. Main 本地 JSON 存储的重启读回与持久授权失效规则。
4. Main → Preload → 诊断日志面板的 opaque `executionId` / `logId` 过滤；不接受自由文本、路径或未知字段。

测试不直接读取 Library Worker 的 SQLite；真实资源库读写将由 `Serpent-y51c.7` 的 Worker 集成测试覆盖。

## 进行中记录

- 2026-07-29：认领 `Serpent-y51c.6`。确认现有 Gateway 已能通过 Main-owned resolver 获取 `executionId` 上下文，但还没有 Execution journal、持久 grant、命令轨迹或日志关联。
- 2026-07-29：采用测试先行；先为 Console 会话授权、保存脚本精确哈希授权、MCP 自授权拒绝、重启中断恢复和 Gateway 审计写入建立失败测试，再实现最小纵向行为。
- 2026-07-29：新增 `src/main/automation-execution-journal.ts`。它以原子 JSON 文件保留受限 execution history 与保存脚本 grant；记录中只保存脚本 SHA-256、UUID 资源库/会话 ID、能力、状态、受限计数和 `logId`，不保存脚本正文、路径或自由文本结果。运行中状态在构造时收口为 `AUTOMATION_INTERRUPTED_BY_RESTART`。
- 2026-07-29：状态机实际保留 `created → validating → awaiting-authorization/running → awaiting-approval → running → terminal` 转换；`start` 是 Main 的创建/验证便捷流程。每条记录持久化 Runtime 将执行的资源预算与墙钟 deadline，并以 `AbortSignal` 向 Gateway 传播会话结束、取消和超时。CPU、内存、输出和 Promise 的 Guest 内硬限制仍由 `Serpent-y51c.4` 的隔离 Runtime 实现。
- 2026-07-29：授权入口改为仅 Main Desktop/TTY 可调用的 `authorizeFromDesktop`，移除了可由 MCP 请求伪造的 `actor` 字段；MCP 和脚本适配层只获得 resolver/Gateway，而非 journal 授权能力。保存脚本 grant 仍精确绑定代码哈希、UUID 资源库和完整能力集合。
- 2026-07-29：Gateway 审计需要同时注入 AppLogger。命令完成后 journal 写入失败不会篡改领域结果，但会以 `automation.execution.audit-failed` 写入独立、持久且带 execution/command ID 的诊断；正常失败也会把稳定失败码、`executionId` 与 `logId` 写入同一应用日志。
- 2026-07-29：为防止活跃 execution 或持久 grant 填满 JSON snapshot，journal 分别设置活跃 execution 上限与有限的终态/授权保留上限；超限以稳定 `AUTOMATION_EXECUTION_LIMIT_REACHED` 拒绝，不先污染记录。Gateway 还按 `executionId` 原子保留/释放 `maxConcurrentCommands` 槽位，超额命令在 Worker 前以 `AUTOMATION_CONCURRENCY_LIMIT_REACHED` 拒绝。
- 2026-07-29：补入被 QuickJS 原型引用但未写入依赖清单的 `quickjs-emscripten@0.32.0`，恢复当前工作树的 `npm run typecheck`。这是现有原型的运行时依赖修复，不改变 Automation API。
- 2026-07-29：按仓库大功能门禁完成独立 Standards 与 Spec 两轴审查。审查发现的审计日志注入、活跃/历史保留上限、MCP 伪造 Desktop 授权、UUID 输入、取消/预算传播、每 execution 命令并发与异步审计窗口计数均已修复；复核未留残余问题。
- 2026-07-30：UtilityProcess Console 已在同一 journal 上实际运行。诊断窗口新增按 opaque `executionId` 或 `logId` 的精确筛选；Console 完成或失败后提供“查看此次运行日志”，直接带入 Main 签发的 `logId`。筛选从 Main 校验到 `AppLogger`，不会搜索任意日志文本或暴露日志文件路径。
- 2026-07-30：补强 `AppLogger` 结构化脱敏。除 API Key/Bearer 文本规则外，`authorization`、`env`、`environment` 等敏感 context 字段现在整体写为 `[REDACTED]`；这防止未来调用者误将环境变量对象持久化。

## 已执行验证

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/automation-execution-journal.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/script-sandbox-preview-runtime.test.ts tests/unit/script-sandbox-preview-controller.test.ts` | 5 files、48 tests 通过。 |
| `npx vitest run --config vitest.config.ts tests/unit/app-logger.test.ts tests/unit/automation-execution-journal.test.ts tests/unit/automation-script-ipc.test.ts tests/unit/script-runtime-utility.test.ts tests/unit/script-runtime-supervisor.test.ts` | 5 files、28 tests 通过；覆盖五种 terminal outcome、grant/重启边界、Main-issued correlation ID 筛选、敏感 context 脱敏及 UtilityProcess IPC。 |
| `node scripts/run-e2e-isolated.mjs tests/e2e/automation-script-rating.test.ts` | 1 Electron E2E 通过：脚本运行后点击“查看此次运行日志”，结果包含对应的 `automation.execution.completed`，不会混入只有 `executionId` 的 runtime spawn 记录。隔离 userData；macOS 单屏按脚本说明回退主显示器。 |
| `npm run test:unit` | 208 files、1636 passed、1 skipped。 |
| `npm run lint` | 通过；仅现有 `library-service.ts` 超过 Babel 500 KB 的生成提示。 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/automation-readonly-command-executor.test.ts` | 1 file、3 tests 通过。 |
| `npm run typecheck` | 通过。 |
| 定向 `eslint`（Automation Gateway、journal、QuickJS 与测试） | 通过。 |
| `npx vite build --config vite.renderer.config.ts` | 通过；现有开发态预览 Worker 仍有 3.5 MB chunk-size 警告，留给正式 Runtime 性能设计。 |

## 下一步

- `Serpent-y51c.4` / `.9` 仍需补齐保存/打开脚本、独立 `.d.ts`、执行历史与正式自动化中心；现有 Console 只是受限开发入口。
- `Serpent-y51c.3` 仍需补齐 macOS/Windows packaged、Windows 实机、停止/崩溃的人工视觉证据，随后才解锁标准插件 Runtime。
- `Serpent-y51c.5` 的 stdio MCP 必须复用这个 resolver/journal，且保持非交互连接不能自授予能力。

## 风险与边界

- Execution journal 绝不保存脚本正文、API Key、Authorization header、环境变量或绝对资源库路径；资源库和会话只接受 Worker/Main 生成的 UUID，journal 仅记录 SHA-256、稳定 ID、能力、状态和受限摘要。
- 日志窗口可以看到已脱敏的近期诊断，并可用一个 opaque 执行/日志 ID 精确定位；Renderer 永不拿到日志文件的绝对路径，也不能提交自由文本日志查询。
- 运行中的 Execution 在应用重启后不能假装继续：会显式收口为失败/中断状态。将来 detached Job 另由 `Serpent-bb56.2` 对账。
- 本切片只提供基础服务，不把 Renderer 变成权限判定方，也不在脚本 Guest 中存储或生成 grant。
