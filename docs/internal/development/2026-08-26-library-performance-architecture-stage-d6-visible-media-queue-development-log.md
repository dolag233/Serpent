# 2026-08-26 大型资源库性能架构阶段 D.6 开发日志：可见媒体队列稳定化

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  
关联工单：`Serpent-sa65`、`Serpent-9e1d8d`、`Serpent-6355d7`、`Serpent-3kfe`

## 目标与根因

D.1–D.5 已经把媒体任务分成可见窗口、后台主任务和后台次任务，但 20k 严格基准仍暴露
两个队列层面的尾延迟问题：

1. 连续的 visible-window 波次之间没有明确的抢占边界，新的远距离跳转可能继续排在旧波次
   后面；相邻窗口的小重叠则不应反复取消并重建任务。
2. 轻量可见波在批次结束时仍会触发全局 500 项补队列和尺寸回填。这些同步 SQL/批处理
   占用同一个 Library Worker，导致分页请求已经很快返回，但真实卡片状态被 Worker 饥饿
   延后。
3. Worker 连续 claim 媒体任务时，即使每个任务本身很短，也可能在下一轮 claim 前占满
   当前事件循环 turn；共享媒体预算的并发更新还可能让一个波次超额消费预算。
4. 20k 基准先前只统计已经挂载 `<img>` 的卡片，漏掉了仍是 image card 但没有 `src` 的
   卡片。该统计缺陷已先撤回旧结论，再用真实卡片 DOM 的严格门禁重新验证。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 远距离可见窗口跳转抢占旧波次，相邻窗口保留重叠避免抖动 | `src/worker/visible-window-policy.ts`、`src/worker/index.ts` 的 visible queue generation/AbortController | `tests/unit/visible-window-policy.test.ts` 7 passed；Worker visible queue 回归包含相同窗口幂等、抢占和取消 | macOS arm64 Electron 20k 真实滚动；Windows、Linux、packaged 未执行 |
| 轻量 viewport wave 不触发全局 500 项补队列和全库尺寸回填 | `src/worker/index.ts` `viewportOnlyWave` guard、pending wave 清理 | `tests/unit/visible-window-policy.test.ts` 7 passed；`thumbnail-throughput.test.ts`、`video-exr.test.ts` 与完整 Worker 回归通过；直接 `scheduleThumbnailQueue` 集成断言尚未单独建立 | 20k 严格跳转的 page/visible wave 结果显示没有旧的全局扫表竞争；真实 NAS/SMB 未执行 |
| 连续媒体 claim 之间让出事件循环，并在共享预算耗尽后停止 | `src/worker/library-service.ts` `yieldBetweenMediaClaims()` 与 budget recheck | `tests/worker/thumbnail-throughput.test.ts` 的 control-yield 测试；完整 Worker 回归保护代理、接触表和恢复顺序 | 20k 基准长任务最大值 0ms（本次样本）；Windows 原生解码器/杀毒环境未执行 |
| 有界媒体波次不在同一波内越过 primary→secondary 链式解锁边界 | `src/worker/library-service.ts` bounded-wave secondary defer 条件 | `tests/worker/video-exr.test.ts` 的 interrupted derivative recovery；56/56 通过 | 任务状态和 artifact 对账仅有 macOS Worker 证据，跨平台 lease/failure 未执行 |
| 摘要页与 BrowseSession 布局快照之间的 ready artifact 状态不丢失 | `src/renderer/asset-card-hover-preview.ts`、`src/renderer/App.tsx` | `tests/unit/asset-card-hover-preview.test.ts` 新增布局回退/失败保护；30 个相关 unit 全部通过 | 20k 严格实库中此前缺 `src` 的 JPG/PNG/TIFF 卡片均实际拿到 `serpent://preview` 并解码 |

## 关键设计

- `shouldPreemptVisibleWindow()` 使用集合重叠率：首次窗口和低于 50% 重叠的远距离窗口
  抢占；相邻窗口不做无意义的 cancel/requeue。
- `scheduleThumbnailQueue()` 将带有显式 `assetIds` 且 `skipStaleRepair=true` 的波次视为
  viewport-only。该波次只处理报告的资产，不在尾部顺手启动全库补队列或 dimension backfill；
  后台补齐仍由独立队列负责。
- 每轮媒体 claim 后使用 `setImmediate` 让出 Worker event loop，并重新读取共享预算，避免
  同一批任务因异步 budget 更新而超额运行。默认 full queue 仍可完成完整代理链；只有显式
  bounded wave 保持 primary/secondary 边界。
- BrowseSession geometry 的 `previewArtifactId` 是同一 session 的布局快照。真实
  `AssetSummary` 页面可能早于缩略图生成完成，因此卡片 cover resolver 在摘要没有失败时
  允许使用该快照；一旦摘要明确报告 failed，不使用快照中的旧 artifact。

## 严格 20k Electron 基准

命令口径（实际临时路径不写入仓库）：

```bash
SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<20k-local-library> \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=20000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT=1000 \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_JUMPS=0.11,0.83,0.37,0.69,0.22,0.77,0.46,0.61,0.15,0.54 \
SERPENT_LARGE_LIBRARY_E2E_GATE=all-images \
npm run test:e2e:large-library-benchmark -- <20k-fixture>
```

提交前工作树、macOS arm64、本地 APFS、独立 userData 的真实 Electron 复测没有达到严格门禁。
这次把“首批可见波次”和“全部可见图片完成”分开记录，并保留冷任务与部分暖机结果；不能用
部分暖机样本冒充稳定通过：

| 运行条件 | 跳转数 | 严格 500 ms 全部解码 | 全部图片完成 p50 / p95 / max | first visual wave p50 / p95 / max | eventual complete |
| --- | ---: | ---: | ---: | ---: | ---: |
| 复用本地夹具，冷缩略图任务占主导 | 10 | 0/10 | 1,938.3 / 5,016.3 / 5,016.3 ms | 156.9 / 851.4 / 851.4 ms | 8/10 |
| 同一夹具部分暖机后 | 10 | 4/10 | 556.3 / 2,283.3 / 2,283.3 ms | 134.9 / 163.0 / 163.0 ms | 10/10 |
| 单点诊断跳转（0.61） | 1 | 0/1 | 1,078.2 / 1,078.2 / 1,078.2 ms | 160.2 / 160.2 / 160.2 ms | 1/1 |
| 恢复并发上限 2 后的最后一次复测 | 10 | 7/10 | 213.8 / 5,008.7 / 5,008.7 ms | 164.2 / 217.8 / 217.8 ms | 7/10 |
| 新建真实 20,000 live asset 夹具，首次冷跑 | 10 | 1/10 | 1,176.9 / 5,005.7 / 5,005.7 ms | 155.1 / 207.2 / 207.2 ms | 9/10 |
| 同一 20,000 live asset 夹具再次暖机 | 10 | 7/10 | 179.2 / 5,015.3 / 5,015.3 ms | 134.8 / 227.0 / 227.0 ms | 8/10 |

`all-images` 是 benchmark 的严格门禁，不是只统计已挂载图片元素的旧口径；失败样本确实
包含 `undecodedImageIds`。旧复用夹具在前一轮复测后仍有 18,831 个 `generate_thumbnail` queued、
4 个 running，只有 686 个 thumbnail/video-poster artifact ready；最后一次复测随着夹具继续
暖机达到 7/10，但仍有 3 个样本在 5 秒观察窗超时，分别剩余 1、6、2 张未解码。因此这组结果主要暴露了
冷缩略图尾延迟，而不是稳定的 warm artifact 浏览延迟。诊断日志中 source-direct 的
`media.get-source-path` 响应约 8–13ms，visible-window 请求在稳定后排队约 0–9ms；实际可见
thumbnail job 约 14–283ms，媒体解码并发为 2，多个冷任务串行尾部构成主要瓶颈。long task
采样没有发现主窗口级长任务热点（诊断样本最大约 53ms）。这只证明当前 macOS 本地 20k
夹具，不能替代 100k、Windows、真实 Eagle/Billfish、NAS/SMB、packaged 或人工验收。

新增的两次复测使用同一份 SQLite 实际计数为 20,000 的本地 APFS 夹具；旧复用夹具只有
19,993 条 live asset，已不再作为严格基准分母。冷跑的精确命令为：

```bash
env SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=/private/tmp/serpent-large-library-perf-20k-final \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=20000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT=1000 \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_JUMPS=0.11,0.83,0.37,0.69,0.22,0.77,0.46,0.61,0.15,0.54 \
SERPENT_LARGE_LIBRARY_E2E_GATE=all-images \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=/private/tmp/serpent-large-library-perf-20k-final-result.json \
npm run test:e2e:large-library-benchmark -- /private/tmp/serpent-large-library-perf-20k-final
```

结果为 `assets=20000`、严格 `1/10`，Playwright 断言失败（期望 10，收到 1）；同一夹具
再次运行的 warm 对照为严格 `7/10`，仍有 2 个样本在 5 秒观察窗内未完成。两次运行均证明
first visual wave 在 500ms 内，但不能证明全部可见图片在 500ms 内完成；这正是当前 D.6 的
未收敛性能债务。

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/asset-card-hover-preview.test.ts tests/unit/virtual-browse-session.test.ts`：2 files / 30 passed。
- `npm run typecheck`：通过。
- `npm run lint`：通过；仅有 `library-service.ts` 超过 Babel 500 KB 优化阈值提示。
- `git diff --check`：通过。
- `npm run test:worker`：85 files passed、14 skipped；1,234 tests passed、21 skipped（约 64s）。
- `npm run test:library-availability`：9 files / 203 passed。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts tests/e2e/image-sequence-viewer.test.ts tests/e2e/document-preview.test.ts`：7 passed、1 skipped（33.1s）。
- `npm run test:unit`：396 files passed、1 skipped；3 files failed、4 tests failed，2,916 passed、2 skipped。
  失败是未改动的 macOS `/var` canonical path 断言、当前 FFmpeg bundle 缺少 `lavfi` 输入格式，以及
  `verify-package` 对 7-byte synthetic `better_sqlite3.node` fixture 的既有门禁；不能记为 Unit 全绿。
- 严格 20k 真实 Electron benchmark：实际 20,000 live asset 夹具的冷跑在 `all-images` 断言处失败
  （收到 1/10，期望 10/10）；同一夹具 warm 对照为 7/10，也不能记为通过。冷跑 p50 1,176.9ms、
  p95/max 5,005.7ms、first visual wave p50 155.1ms，eventual complete 9/10；warm 对照
  p50 179.2ms、p95/max 5,015.3ms、first visual wave p50 134.8ms，eventual complete 8/10。

## 竞态收口与证据边界

本轮额外修复了一个 pending visible wave 竞态：可见波次处理完成前保留 pending identity，
处理完成后禁止旧后台闭包继续执行；如果处理期间有更新的可见波次到达，则只重新接管最新波次。
可见波即使恰好处理满 `processWaveSize` 也会在 cleanup 边界让出，不会绕过清理直接进入全局
500 项填充或尺寸回填。定向策略测试覆盖判定函数，完整 Worker 回归覆盖周边媒体队列；真实
Worker `scheduleThumbnailQueue` 的直接注入/断言、混合 IPC 压力下的 event-loop 尾延迟仍未单独执行。

## 未完成与下一步

### 启动门隔离修正（2026-08-26）

独立审查发现原 startup gate 使用进程级 `inFlight`/browse 标志；在 Worker 同时保有多个
打开库时，一个库的首屏可能错误释放另一个库的对账，重新打开也可能取消旧库的等待者。
现已抽出 `src/worker/startup-burst-gate.ts`，按 `libraryId + libraryGeneration` 维护
opening sentinel、在飞计数、首个 browse 投递状态、硬上限 timer 和取消状态；生命周期结果
统一在 generation 已观察后安装 gate，开库响应 post 后释放 sentinel。startup 缩略图和对账
共用同一 token，关闭/删除只取消目标库，shutdown 取消全部 gate。

自动化证据：`node scripts/run-vitest-with-electron.mjs run tests/unit/startup-burst-gate.test.ts tests/unit/interactive-scheduler.test.ts`
为 2 files / 18 tests passed；`npm run typecheck`、`npm run lint`、`git diff --check` 和
`npm run test:library-availability`（9 files / 203 tests）通过。该修正没有增加新的平台证据；
Windows、真实 NAS/SMB、packaged 和 Computer Use/人类视觉仍未执行。

D.6 的队列抢占、取消收口、Worker yield 和可见卡片真实性修复已实现，但严格 20k 冷任务门禁
仍未达标，`Serpent-sa65`、`Serpent-3kfe` 和相关性能工单不能关闭。下一步仍按架构顺序进入
远程资源库的本地只读元数据快照/变更校验（对应 `Serpent-08a344`、0032 §13.2）；D.6 的
冷缩略图尾延迟与这组基准的前置状态必须作为后续阶段的回归基线继续保留。100k 规模、Windows、
真实 NAS/SMB、packaged 和 Computer Use/人类视觉证据仍缺失。
