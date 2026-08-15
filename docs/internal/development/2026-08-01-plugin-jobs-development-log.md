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

## 2026-08-02 P1 收口

- Standard/Trusted runtime 在实例停用、进程退出、心跳超时、协议故障和 shutdown 时结算全部 pending Job，避免 Scheduler drain 永久等待；故障结算后的迟到 completion 会被忽略。
- Scheduler 捕获 Worker/运行时 rejection 并释放实例 drain 锁；运行时合成的退出/协议故障结果交由 owner-scoped pause 处理，避免与持久化暂停竞态写成终态 failed；实例崩溃只暂停对应插件 owner，不再暂停同库其他插件。
- 迟到 completion tombstone 按 `instanceId + jobId` 隔离，旧实例消息不会吞掉重绑定实例的同 Job completion。
- Host 展示百分比统一以 `completed / total` 为权威来源；仅在 total 未知或为 0 时回退插件上报的 `progress`，并对插件错误详情做长度限制和路径脱敏。
- 应用进程退出或崩溃后，下一次 Worker 会话会把上一会话遗留的 `queued`/`running` Job，以及由插件失活留下的暂停 Job，变成 Host-owned `interrupted`；同一 Worker 内关闭再打开资源库不会误标记，下一会话也不会自动 claim 旧任务。
- 显式 retry 才会把 `interrupted` Job 重新置为 `queued`，并允许新插件实例接管；Job 的 `recovery` 字段仍只描述插件自己的幂等/检查点能力。
- Worker 回归测试覆盖中断、保留进度、禁止自动 claim 和显式重试；完整 Electron E2E `node scripts/run-e2e.mjs tests/e2e/plugin-job-recovery.test.ts` 已通过（1 passed），证明旧 Job 保持 `interrupted`、新命令产生的新 Job 可完成。
