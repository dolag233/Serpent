# 模型离屏与 AI 队列活性修复开发日志

> 日期：2026-09-20
> 状态：P0 增量已实现，待真实 Electron/病态 loader 验收
> 关联方案：[当前实例模型、AI 与 Worker 调度活性分析](../implementation/2026-09-20-current-instance-model-ai-scheduler-profile.md)

## 1. 本增量解决的问题

当前实例 profile 显示：模型离屏页面停在可选 HDRI 加载；AI 任务已进入 cancelled，但模型分析没有继承任务 signal；Main 离屏队列没有任务级取消和 watchdog；`ai.process-queue` 跨越外部等待持有 Worker 后台许可。结果普通缩略图和源/产物路径查询长时间零进展。

本增量只处理活性闭环，不改变 SQLite schema、媒体并发上限或 FBX 转换实现。

## 2. 实现内容

- `model-thumbnail.render-request` 增加可选 `enableHdri`；Worker 后台模型任务默认关闭 HDRI，使用确定性 key light。
- Offscreen page 对仍启用的 HDRI 请求增加 1.5 秒 fail-open 超时；超时后继续模型加载并记录已有失败诊断。
- Worker 的模型请求 signal abort 时向 Main 发送 `model-thumbnail.render-cancel`；Main 转发到 offscreen queue。
- Offscreen queue 支持取消 queued/active 请求。active 请求会 settle 为 `MODEL_RENDER_ABORTED`、销毁共享窗口，下一请求自动创建干净窗口。
- Offscreen queue 增加 20 秒总 watchdog，覆盖页面加载、模型加载、渲染和回复不返回的情况。
- `withModelRenderGate` 在等待前一个模型任务时支持 abort；取消的排队节点会等前序节点结束后再释放自己的 tail，不会造成后续模型任务永久并发或永久等待。
- `asset.analyze` 的模型四视图改为使用当前分析任务的 signal，不再创建脱离任务生命周期的新 controller。
- `InteractiveScheduler.runWithoutAdmission` 支持外部异步等待期间释放 owner，等待完成或高优先级请求结束后重新取得 admission。
- `ai.process-queue` 先以 bounded wave 接入释放边界，随后收口为按阶段的 `runExternal`：批次中的 claim/commit 仍由 Worker 单线程顺序执行，图片/模型/供应商等待逐段让出 admission。Main 侧把一批任务切成最多 8 项的 continuation，波次之间重新取得调度机会，避免长批次占用单一命令。
- 生命周期取消会通过 scheduler cancel hook 触发当前库的 AI job abort registry。
- `ai.process-queue` 增加 batch-level `AbortController`；生命周期取消后停止后续 claim，同时中止当前已注册的 job controllers。
- 自动同步轮询按 library 做 in-flight 去重；轮询期间的 timer tick 只保留一个 trailing pending，完成后按最新绑定再次检查，避免长请求期间不断堆积 `sync.poll-remote`。
- 自动同步轮询增加 lifecycle generation 与 binding identity；停止、重启或重新绑定后，旧请求的 late response 不再触发同步，也不会把旧绑定的 pending 重新接回新绑定。
- AI 队列增加 `SERPENT_WORKER_CMD_LOG=1` 下的 `worker.ai.phase` 观测，分别记录 claim、asset.analyze 的 prepare、external-await、AI 内容 commit 以及 job-state commit，便于将“任务慢”拆成数据库、媒体准备还是供应商等待。
- 本轮进一步移除“整波次一次释放 admission”的边界：`asset.analyze` 的视频 contact-sheet、图片输入、模型离屏和供应商请求分别通过 `runExternal` 释放外部等待，完成后在下一段本地 claim/commit 前重新取得 admission；同一波次的并发 lane 共享带引用计数的 released scope，所有外部阶段完成后才重获 owner；新增 scheduler 回归测试覆盖单 lane 两阶段与多 lane 交错 barrier。
- 视频 AI 输入、图片缩略图回退和 FBX 转换均继续传递 AbortSignal；取消在生成完成后到达时不会被“复用已生成 artifact”的兜底路径吞掉。视频 contact-sheet/ffprobe 采用共享底层任务、逐调用者可取消等待，全调用者取消才终止，并且取消不会登记 failed artifact 或留下临时 JSON/JPEG。
- `render-cancel` IPC 经过共享 Zod schema；companion 扩展名在 Worker 边界做小写和长度规范化，避免异常后缀让整个请求被协议拒绝。
- Offscreen `runJob` 对窗口加载加入 cancellation race；取消/watchdog 会让 drain 立即进入下一任务，且 paint 回调绑定窗口身份，避免旧窗口迟到帧污染新任务。
- HDRI fail-open 对超时后迟到的环境结果安装 dispose 兜底，释放 PMREM 和源纹理；companion 进一步限制为产品支持的图片/模型及 `.bin`、`.json`、`.mtl` 集合。

## 3. 证据

执行命令：

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/offscreen-page-renderer.test.ts tests/unit/offscreen-thumbnail-renderer.test.ts tests/unit/interactive-scheduler-admission-yield.test.ts tests/unit/worker-client.test.ts tests/unit/sync-auto-scheduler.test.ts
```

结果：6 个文件、63 个测试通过（含 pending window load 取消/renderer crash 重建、非法 cancel IPC、HDRI late-result dispose、companion 扩展名边界）。

```text
npm run typecheck
```

结果：主 TypeScript 与 extension TypeScript 均通过。

```text
npx eslint src/shared/model-thumbnail-protocol.ts src/renderer/offscreen-thumbnail/page-renderer.ts src/main/offscreen-thumbnail-renderer.ts src/main/worker-client.ts src/main/index.ts src/worker/interactive-scheduler.ts src/worker/index.ts tests/unit/offscreen-page-renderer.test.ts tests/unit/offscreen-thumbnail-renderer.test.ts tests/unit/interactive-scheduler-admission-yield.test.ts tests/unit/worker-client.test.ts
```

结果：通过。

```text
npm run test:library-availability
```

结果：Electron ABI/FTS5 pretest 通过；9 个文件、228 passed、1 skipped。该门禁覆盖资源库打开/关闭、schema 兼容与 library-service 回归；没有把它当成真实实例性能 A/B。

```text
npx vitest run tests/unit/sync-auto-scheduler.test.ts tests/unit/model-resolution.test.ts tests/unit/interactive-scheduler.test.ts tests/unit/interactive-scheduler-admission-yield.test.ts tests/unit/offscreen-thumbnail-renderer.test.ts tests/unit/offscreen-page-renderer.test.ts tests/unit/worker-client.test.ts
```

结果：7 个文件、91 个测试通过；新增 stop/restart、重新绑定后的 late-response，以及旧 sync 返回时不再 trailing 的回归覆盖。

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/ai-analysis.test.ts tests/worker/ai-completion.test.ts tests/worker/ai-video.test.ts tests/worker/video-ai-input.test.ts tests/worker/fbx-conversion.test.ts
```

结果：5 个文件、111 个测试通过。直接用 Node 运行这些 Worker 测试会因 better-sqlite3 ABI 不匹配而失败，不能作为产品回归证据；本次改用项目规定的 Electron runner。

```text
node scripts/generate-large-library.mjs --output <隔离临时目录> --assets 20000 --reset
npm run test:perf:large-library -- <同一隔离临时目录>
```

结果：20,000 资产基线通过（3 tests）。当前 HEAD 最后一轮 startup 7.5ms、all browse 10.3ms、folder switch 0.4ms、collection recursive switch 38.7ms、search 15.4ms、reconciliation 2.1s；event-loop lag p95 0.7ms、max 77.3ms。该基线是合成库，不替代用户真实链接库 profile。与历史同套基线记录的 collection recursive switch 28.3ms 不构成正向证据，说明本轮 P0 活性改动没有证明导航全面变快；该指标应在后续真实 profile 中单独归因，不能用其它指标掩盖。

## 4. 尚未验证与下一步

- 尚未在真实 Electron 中注入永久 pending HDRI/模型 loader，需证明窗口回收后下一模型任务和普通图片缩略图都能继续。
- 尚未在真实实例上复测 `cancel-to-release`、scheduler owner 连续持有时间、source/artifact p95 和缩略图队列恢复速度。
- 尚未在真实 Electron 中验证 gate 排队取消、窗口加载永久 pending、旧窗口 late paint、批次取消后的“停止继续 claim”以及 500 ms 收敛预算。
- 20 秒 watchdog 是总请求预算，不替代后续按 window-ready、model-load、render、readback 分阶段指标。
- `FBX` 冷转换仍在后续工单中；当前只解决它被后台 owner 饿死的前置问题。
- AI 队列已经具备有界 continuation 和 claim/prepare/external-await/commit 阶段指标，且每个外部阶段都会单独释放并重新取得 admission；但还没有完成真实 Electron 下 50 ms 连续 owner、永久供应商等待和 cancel-to-release 的 A/B 证明。大型链接目录分块、FBX helper、Renderer heap/隐藏 WebGL 保留者和完整对账 continuation 仍在对应 P1 工单中，不能在本日志中写成已完成。

Luna High 复审指出的 P0 活性竞态已修复并由定向测试覆盖；本增量仍不得标记为真实实例性能验收通过。需要真实 Electron、20k 混合 fixture 和病态等待 fixture 的 A/B 证据。

## 5. 阶段化 continuation 后性能复测

在隔离临时 fixture 上重新生成 20,000 资产混合库并运行 `npm run test:perf:large-library`：

```text
startupMs=8.7
allBrowseMs=11.2
folderSwitchMs=0.5
collectionRecursiveSwitchMs=42.2
collectionRecursiveLayoutMs=77.9
searchMs=16.9
layoutMs=107.3
navigationSummaryInitialMs=68.8
reconciliationMs=2581.6
eventLoopLagP95Ms=0.9
eventLoopLagMaxMs=78.9
viewerResolveP95Ms=2.0
cachedHit=true
```

本轮 3 个性能用例通过。文件夹首屏和普通浏览仍在合成目标内；递归合集切换较历史同套记录（28.3ms）偏慢，不能宣称全面正向，需由后续导航 profile 单独归因。性能 fixture 使用仓库外隔离目录，测试结束后已清理。
