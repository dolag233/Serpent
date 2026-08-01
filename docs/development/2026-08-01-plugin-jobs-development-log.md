# 2026-08-01 插件后台 Job（Phase D slice 3）

## 范围

`Serpent-upsn.5` 第三个可验收增量：插件 Job 持久化 + Host/Scheduler + 任务列表展示。

首条垂直切片：

- Manifest `contributes.jobs` + Contribution 注册（`kind: job` / `target: jobs`）
- Worker 持久化（schema v27，`plugin.jobs.*` 命令）
- Host 协议：`job-enqueue` / `job-enqueue-result` / `job-invoke` / `job-complete`（standard + trusted）
- SDK：`serpent.jobs.registerHandler` / `serpent.jobs.enqueue`
- Main：`PluginJobScheduler` claim → invoke → complete；停用/Safe Mode 时 `pause-owners`
- Renderer：`plugin.list-jobs.request` → MediaJobsDialog「插件任务」分区（显示 `ownerPluginId` + handler）
- 固定探测插件：`tests/fixtures/plugins/job-probe/`
- 人类验收：`PLUGIN-008`

## 实现要点

- `src/plugins/plugin-jobs.ts`：记录 schema、invoke 队列、默认超时 `PLUGIN_JOB_DEFAULT_TIMEOUT_MS`
- `src/main/plugin-job-scheduler.ts`：按库+插件实例 claim-next、invokeJob、complete
- Standard guest：`__nextJob` / `__respond` / `__enqueue` 桥接（镜像 hook 队列）
- Trusted：Node bridge 内 handler Map
- `enqueue` 需 `job.manage` + manifest 声明的 handler id；handler 抛错 fail-open 为 `failed`
- 超时：`PLUGIN_JOB_TIMEOUT`，由 scheduler 写回 Worker
- `src/shared/plugin-job-status.ts`：Worker 行 → 对话框摘要计数

## 明确推迟

- 插件 Job 的暂停/继续/取消/重试控件（本切片只读列表）
- packaged / Windows / Computer Use
- checkpoint 恢复语义细化

## 验证

定向单测：

- `tests/unit/plugin-standard-host.test.ts`（job-enqueue + job-invoke → job-complete）
- `tests/worker/plugin-jobs.test.ts`（持久化）
- `tests/unit/plugin-job-status.test.ts`（摘要计数）
- `tests/unit/protocol.test.ts`（`plugin.list-jobs.request`）

命令摘要：`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/plugin-job-status.test.ts tests/unit/plugin-standard-host.test.ts tests/worker/plugin-jobs.test.ts tests/unit/protocol.test.ts` → 4 files / 71 tests passed。
