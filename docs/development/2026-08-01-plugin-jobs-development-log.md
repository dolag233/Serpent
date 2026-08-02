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

- `src/plugins/plugin-jobs.ts`：记录 schema、invoke 队列和插件可上报的完成/失败结果
- `src/main/plugin-job-scheduler.ts`：按库+插件实例 claim-next、invokeJob、complete
- Standard guest：`__nextJob` / `__respond` / `__enqueue` 桥接（镜像 hook 队列）
- Trusted：Node bridge 内 handler Map
- `enqueue` 需 `job.manage` + manifest 声明的 handler id；handler 抛错 fail-open 为 `failed`
- Job handler 不由 Host 设置统一超时；插件通过 handler 抛错或完成结果决定失败语义
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

## 2026-08-02 P1 可发现性跟进

补齐插件 Job 已有进度协议与主界面的连接：

- `App.tsx` 将 queued/running Plugin Job 纳入 `backgroundJobsActive`；资源库切换时清空旧库 Job 摘要，避免工具栏沿用旧状态。
- 工作区画布上方复用统一后台任务活动条，采用“插件/handler + 状态信息”与“进度条”两行布局，显示 `phase`、`message`、`completed/total`、百分比和失败/取消原因。
- 活动条的“后台运行”和 `×` 都只隐藏前台提示，不取消 Job；任务继续运行，并可从工具栏的后台任务入口查看。
- `WorkspaceToolsOverflow` 的后台任务入口在存在插件 Job 时显示活动标记；完成、失败、取消或暂停结果在活动条中保留短暂时间，任务面板仍保留完整历史。
- 移除 Host 对 Plugin Job handler 的统一墙钟超时；插件自行决定超时策略并通过 handler 抛错或完成结果报告失败。Host 只在插件实例停用、运行时崩溃、心跳丢失或协议故障时终止运行时。
- 新增 `plugin-job-activity` 选择逻辑测试及运行时/调度器回归测试；本次没有执行完整 Electron E2E、packaged 或 Windows 验收。
