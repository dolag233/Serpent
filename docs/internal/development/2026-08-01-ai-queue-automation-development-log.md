# 2026-08-01：自动化 AI 入队触发 Main 调度

> 工单：`Serpent-b2qv.2`
> 状态：实现完成，保留真实供应商与平台验收边界

## 目标

补齐脚本/MCP 的 AI 自动化闭环：`ai.enqueue` 通过 Gateway 成功写入 Worker 队列后，必须触发 Main 进程现有 `AiQueueScheduler`，使任务继续从 `queued`/`running` 推进到 `succeeded` 或明确失败。

## 实现

- `AutomationLibraryWorkerAdapter` 增加 Main-owned `onAiEnqueued` 接缝。
- 仅当 Worker 返回成功的 `ai.jobs.enqueued`，且有新入队或已有 pending Job 时触发。
- Worker 拒绝、只读查询、无任务结果和已取消请求不触发。
- 调度回调采用 fire-and-forget；调度器失败通过 Main Logger 记录，不改变已经提交的入队结果。
- Main Gateway 与文件计划共享同一个配置过调度接缝的 Adapter；没有新增 AI 供应商、数据库表或旁路 Worker。

## 验证

- `npx vitest run tests/unit/automation-worker-adapter.test.ts`：3/3 通过。
- `npx vitest run tests/unit/automation-worker-adapter.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/ai-queue-runtime.test.ts`：3 个测试文件、48/48 通过。
- `npm run typecheck`：主 TypeScript 与扩展 TypeScript 通过。
- `npm run lint`：通过。
- `node scripts/run-e2e.mjs tests/e2e/automation-mcp-library-create.test.ts`：1 passed（7.5s）；真实 MCP stdio 建库/inspect 回归通过。该 E2E 未配置真实 AI 供应商，因此不宣称 AI 状态已完成。

## 尚未验证

- 真实 AI 供应商配置下的 MCP/Console 入队到状态完成旅程。
- Computer Use、packaged macOS、Windows。
