# 2026-07-29：Automation Execution 日志与能力授权（Serpent-y51c.6）

> 状态：automated-verification（双轴审查已完成，等待与共享工作树一并提交）
>
> 基线：`a160f60`（共享工作树已有未提交的 Automation Gateway、QuickJS 原型和开发态沙箱预览增量）
>
> 规格：[0023 脚本自动化与 MCP](../implementation/0023-automation-scripting-mcp-framework.md)，决策：[ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)。

## 目标

为后续 Desktop Console、受控脚本与 MCP 建立 Main-owned `Automation Execution` 基础：单库绑定、脚本内容哈希、能力授权、状态机、取消/终止、命令审计、脱敏日志引用和应用重启恢复。

本切片不开放用户可用的真实资源库脚本读写入口；那需要后续 Script Runtime、Console 和跨进程写租约切片。当前开发态“脚本沙箱预览”仍保持 echo-only，不能借此绕过授权。

## 预先确定的测试接缝

1. `AutomationExecutionJournal` 的公开创建、授权、解析、终止、完成和重启恢复接口。
2. `Automation Command Gateway` 调用后的公开审计结果；审计写失败不得改变命令结果。
3. Main 本地 JSON 存储的重启读回与持久授权失效规则。

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

## 已执行验证

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/automation-execution-journal.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/script-sandbox-preview-runtime.test.ts tests/unit/script-sandbox-preview-controller.test.ts` | 5 files、48 tests 通过。 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/automation-readonly-command-executor.test.ts` | 1 file、3 tests 通过。 |
| `npm run typecheck` | 通过。 |
| 定向 `eslint`（Automation Gateway、journal、QuickJS 与测试） | 通过。 |
| `npx vite build --config vite.renderer.config.ts` | 通过；现有开发态预览 Worker 仍有 3.5 MB chunk-size 警告，留给正式 Runtime 性能设计。 |

## 下一步

- `Serpent-y51c.4` 需要消费该 journal，提供真正隔离的只读 Script Runtime、独立 `.d.ts` 和 Desktop Console。
- 真实“搜索名称或标签含 Ser 的资产并批量改为 4 星”还依赖 `Serpent-bb56.2` 写租约与 `Serpent-y51c.7` 的低风险批量写入；不能由当前开发态预览绕过。

## 风险与边界

- Execution journal 绝不保存脚本正文、API Key、Authorization header、环境变量或绝对资源库路径；资源库和会话只接受 Worker/Main 生成的 UUID，journal 仅记录 SHA-256、稳定 ID、能力、状态和受限摘要。
- 运行中的 Execution 在应用重启后不能假装继续：会显式收口为失败/中断状态。将来 detached Job 另由 `Serpent-bb56.2` 对账。
- 本切片只提供基础服务，不把 Renderer 变成权限判定方，也不在脚本 Guest 中存储或生成 grant。
