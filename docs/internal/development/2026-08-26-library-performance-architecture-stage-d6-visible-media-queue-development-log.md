# 2026-08-26 大型资源库性能架构阶段 D.6 开发日志：可见媒体队列稳定化

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  
关联工单：`Serpent-sa65`、`Serpent-9e1d8d`、`Serpent-6355d7`、`Serpent-3kfe`

说明：文档前半部分的表格保留了当时运行记录；后续重新核对夹具后确认，目录名为 20k 的
本地夹具实际 SQLite live asset 数为 19,965。当前口径和修复后的结果见文末追加章节，不把
历史的 20,000 分母或旧的 warm 结果当作当前严格门禁证据。

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
| Sharp/OIIO/FFmpeg 共用 native 内存准入预算，超大 OIIO 输入在 spawn 前拒绝 | `src/worker/media-memory-budget.ts`、`src/worker/library-service.ts` 的 decoder wrappers 与 OIIO preflight | `tests/unit/media-memory-budget.test.ts`；`tests/worker/video-exr.test.ts` 的超像素输入不 spawn 回归；混合媒体 RSS benchmark | macOS arm64 Worker+子进程 RSS 3×100 任务；Windows、真实 NAS/SMB 和独立平台 native allocator 未执行 |
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
| 当时按 20,000 live asset 报告的夹具，首次冷跑 | 10 | 1/10 | 1,176.9 / 5,005.7 / 5,005.7 ms | 155.1 / 207.2 / 207.2 ms | 9/10 |
| 同一夹具再次暖机（当时按 20,000 live asset 报告） | 10 | 7/10 | 179.2 / 5,015.3 / 5,015.3 ms | 134.8 / 227.0 / 227.0 ms | 8/10 |

`all-images` 是 benchmark 的严格门禁，不是只统计已挂载图片元素的旧口径；失败样本确实
包含 `undecodedImageIds`。旧复用夹具在前一轮复测后仍有 18,831 个 `generate_thumbnail` queued、
4 个 running，只有 686 个 thumbnail/video-poster artifact ready；最后一次复测随着夹具继续
暖机达到 7/10，但仍有 3 个样本在 5 秒观察窗超时，分别剩余 1、6、2 张未解码。因此这组结果主要暴露了
冷缩略图尾延迟，而不是稳定的 warm artifact 浏览延迟。诊断日志中 source-direct 的
`media.get-source-path` 响应约 8–13ms，visible-window 请求在稳定后排队约 0–9ms；实际可见
thumbnail job 约 14–283ms，媒体解码并发为 2，多个冷任务串行尾部构成主要瓶颈。long task
采样没有发现主窗口级长任务热点（诊断样本最大约 53ms）。这只证明当前 macOS 本地 20k
夹具，不能替代 100k、Windows、真实 Eagle/Billfish、NAS/SMB、packaged 或人工验收。

新增的两次复测当时曾按 SQLite 计数 20,000 报告；后续审计发现该目录名为 20k 的夹具当前实际
只有 19,965 条 live asset，因此这些历史结果保留作过程记录，不再作为严格基准分母。冷跑的
命令模板为（实际隔离路径不写入仓库）：

```bash
env SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<isolated-20k-library> \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=20000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT=1000 \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_JUMPS=0.11,0.83,0.37,0.69,0.22,0.77,0.46,0.61,0.15,0.54 \
SERPENT_LARGE_LIBRARY_E2E_GATE=all-images \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=<isolated-result.json> \
npm run test:e2e:large-library-benchmark -- <20k-fixture>
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
- 历史严格 20k 真实 Electron benchmark：当时按 20,000 live asset 报告的冷跑在 `all-images`
  断言处失败（收到 1/10，期望 10/10）；同一夹具 warm 对照为 7/10，也不能记为通过。该夹具
  后续审计为 19,965 条 live asset，所以上述数字只保留作历史过程记录，不作为当前分母。
  历史冷跑 p50 1,176.9ms、p95/max 5,005.7ms、first visual wave p50 155.1ms、eventual
  complete 9/10；warm 对照 p50 179.2ms、p95/max 5,015.3ms、first visual wave p50 134.8ms、
  eventual complete 8/10。

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

## 2026-08-26 追加：path cache 竞态修复与当前冷基准

### 新发现的根因

在逐任务对账时发现，缩略图生成已经把 `revision_artifacts` 写成 `ready`，但 Main 同时收到
`library.changed` 并推进 artifact-path cache generation。正在解析新 artifact 的
`serpent://preview` 请求因此被 generation fence 判为 stale；Renderer 的 `AssetCardMedia`
会把这次瞬态协议失败记成永久 broken fallback。数据库最终状态看似正常，真实卡片却没有
`src`，这也是旧冷跑中 5 秒超时和“最终 artifact ready、卡片未解码”同时出现的原因。

修复位置为 `src/main/index.ts` 的 `publishLibraryChanged`：派生 artifact 写入只发布领域事件，
不再推进 Main 的路径缓存 generation。资产/源文件变化仍由 `asset.changed` 精确清除，close/reopen
仍清除整个缓存；协议实际读失败仍只失效对应 artifact。这样不改变路径授权边界，也不会让真实
的源文件变化继续使用旧路径。

### 受控冷基准（path-cache 修复后的历史样本）

本次使用全新的本地 APFS copy-on-write 隔离库，删除了隔离副本中 18,223 个 primary thumbnail/
video-poster artifact，源夹具未修改；目录名为 20k，但 SQLite 实际 live asset 数为 19,965，
因此以下不是严格 20,000 分母。真实 Electron、独立 userData、10 个固定随机跳转、
`SERPENT_LARGE_LIBRARY_E2E_GATE=all-images` 的结果如下：

命令模板（实际隔离路径不写入仓库）：

```bash
SERPENT_MEDIA_QUEUE_LOG=1 \
SERPENT_WORKER_CMD_LOG=1 \
SERPENT_VIEWER_TIMING_LOG=1 \
SERPENT_LARGE_LIBRARY_E2E_JUMPS=0.11,0.83,0.37,0.69,0.22,0.77,0.46,0.61,0.15,0.54 \
SERPENT_LARGE_LIBRARY_E2E_GATE=all-images \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=19000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT=1000 \
SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<isolated-20k-library> \
SERPENT_LARGE_LIBRARY_E2E_USER_DATA_PATH=<isolated-user-data> \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=<benchmark-result.json> \
SERPENT_LARGE_LIBRARY_E2E_PROFILE_DIR=<isolated-profile> \
node scripts/run-large-library-e2e-benchmark.mjs <20k-fixture>
```

| 指标 | path cache 修复后的历史 HEAD（内存预算加固前） |
| --- | ---: |
| 严格 500ms 内全部可见图片完成 | 3/10 |
| 全部可见图片完成耗时 p50 / p95 / max | 566.1 / 633.4 / 633.4 ms |
| first visual wave p50 / p95 / max | 128.1 / 167.2 / 167.2 ms |
| 观察窗内最终完成 | 10/10 |
| stale artifact-path protocol error | 0 |
| Main long-task max | 0 ms |

相对于紧邻的竞态修复前同口径冷跑（1/10、p50 701.3ms、p95/max 5,008.9ms、最终 7/10），
失败不再被 5 秒超时和永久 broken fallback 放大；但 500ms 全图片硬门禁仍为红灯。当前架构
规定的“500ms 内开始出现首屏”在这次样本中达到（first visual wave p95 167.2ms），不能据此
关闭 `Serpent-sa65`。

### 安全性约束与未纳入的实验

- 可见波次只对源大小 ≤32MiB、已知尺寸且解码像素 ≤16MP 的普通图像启用交互 Sharp lane；
  进程级 Sharp native cap 为 4，后台 lane 仍为 2，视频/音频/OIIO/模型不共享这条放大路径。
- TIFF 只在源 ≤16MiB、已知 IFD 尺寸且 ≤16MP 时使用 Sharp；未知、超限或结构不完整的 TIFF
  继续使用 OIIO。TIFF IFD 探针最多读取 256KiB，不读取整个源文件；同步和异步路径均在
  `finally` 关闭句柄。
- 先前尝试把 Sharp resize kernel 改为 `linear` 已撤回：有一个 TIFF 在 Renderer 中进入 stale
  路径，虽然后台 artifact 最终存在，但该样本没有完整解码证据，不能作为性能结论。当前代码
  不包含该实验参数。

## 2026-08-26 追加：审查后 native 内存加固与当前 HEAD 冷基准

### 审查发现与修正

Luna High 代码审查指出，仅按解码器并发数和像素上限限流，不能约束 Sharp、OIIO、FFmpeg
各自的 native allocation；尤其 OIIO 的 `--resize` 主要限制输出尺寸，不能证明源图在解码前
不会产生超大分配。本轮补齐了跨解码器、跨已打开资源库的 `mediaNativeMemoryBudget`：

- 每个 Library Worker 共享 384 MiB 的估算 native admission budget，按已知宽高的 RGBA
  footprint、有限 source staging 和 decoder overhead 估算；未知输入使用按解码器区分的保守
  reservation，并在 `finally` 释放。它是确定性的准入保护，不是操作系统 cgroup。
- Sharp、OIIO、FFmpeg 都必须先获得这条共享预算再启动 native work；可见图像仍最多使用
  4 个 Sharp 交互槽位，后台图像为 2 个槽位。已知超过 64 MP 的 OIIO 输入，以及无法读出
  尺寸且超过 512 MiB 的 OIIO 输入，在 spawn 前以 `MEDIA_INPUT_TOO_LARGE` 拒绝，原文件不变。
- 缩略图关键路径的 TIFF/图像尺寸探针改为异步；TIFF 只读取有界 IFD，截断、超大 IFD、
  BigTIFF 或无法证明安全的输入保留 OIIO/失败保护路径。普通 TIFF 的 Sharp/OIIO 分流与
  JPEG/PNG/WebP magic 校验均有回归测试。

### 当前 HEAD 严格冷基准

当前提交使用全新的本地 APFS copy-on-write 隔离库，删除 18,226 个视觉 artifact、取消
2,321 个遗留排队任务后运行真实 Electron；SQLite 实际 live asset 为 19,965，目录名仍是
20k。固定 10 个随机跳转、`all-images` 严格门禁、5 秒观察窗的结果：

命令模板（实际隔离路径不写入仓库）：

```bash
SERPENT_MEDIA_QUEUE_LOG=1 \
SERPENT_WORKER_CMD_LOG=1 \
SERPENT_VIEWER_TIMING_LOG=1 \
SERPENT_LARGE_LIBRARY_E2E_JUMPS=0.11,0.83,0.37,0.69,0.22,0.77,0.46,0.61,0.15,0.54 \
SERPENT_LARGE_LIBRARY_E2E_GATE=all-images \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=19000 \
SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<isolated-20k-library> \
SERPENT_LARGE_LIBRARY_E2E_USER_DATA_PATH=<isolated-user-data> \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=<isolated-result.json> \
npm run test:e2e:large-library-benchmark -- <20k-fixture>
```

| 指标 | 当前 HEAD |
| --- | ---: |
| 严格 500ms 内全部可见图片完成 | 2/10 |
| 全部可见图片完成耗时 p50 / p95 / max | 571.1 / 657.5 / 657.5 ms |
| first visual wave p50 / p95 / max | 131.0 / 215.0 / 215.0 ms |
| 观察窗内最终完成 | 10/10 |
| Main long-task max | 0 ms |
| stale artifact-path protocol error | 0（本次独立 userData 日志未发现） |

该结果证明当前首批可见波次符合架构的 500ms 首屏目标，但 `Serpent-sa65` 的“全部可见
图片 500ms 内完成”仍只有 2/10，不能关闭严格性能债务；全部完成 p50 仍超过 500ms，
尾部主要来自冷缩略图生成/传输，而不是 Main 长任务。

### 当前 HEAD 混合媒体内存基准

用相同 20k 夹具自动创建 disposable APFS clone，选取 100 个非 source-direct 的 JPG/PNG/WebP/
GIF/TIFF 与 MP4/WebM/MOV/WAV 资产，连续运行 3 轮，每轮删除本轮视觉 artifact 后重新入队。
该基准在 Worker 进程及其子进程上采样 RSS，同时记录事件循环延迟：

```bash
SERPENT_MEDIA_TASK_PERF_ASSETS=100 \
SERPENT_MEDIA_TASK_PERF_ROUNDS=3 \
SERPENT_MEDIA_TASK_PERF_MAX_RSS_DELTA_MB=768 \
SERPENT_MEDIA_TASK_PERF_RESULT_PATH=<native-result.json> \
npm run test:perf:media-tasks -- <20k-fixture>
```

| 轮次 | 任务 | 完成 | 耗时 / 吞吐 | 基线 RSS / 峰值进程树 RSS | RSS 增量 | 最大事件循环延迟 | 资源失败 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100 | 100 | 3,081.9 ms / 32.45 s⁻¹ | 192.5 / 280.8 MiB | 88.3 MiB | 73.7 ms | 0 |
| 2 | 100 | 100 | 2,807.0 ms / 35.63 s⁻¹ | 264.7 / 303.7 MiB | 39.0 MiB | 11.4 ms | 0 |
| 3 | 100 | 100 | 2,820.7 ms / 35.45 s⁻¹ | 282.3 / 303.8 MiB | 21.5 MiB | 7.0 ms | 0 |

三轮均完整入队/完成、资源失败为 0；峰值 RSS 增量为 88.3 MiB，事件循环最大延迟为
73.7 ms。该结果是当前 macOS arm64 本地基准的证据，不等同于 Windows/真实 NAS/SMB 的
native allocator 证明；共享 384 MiB admission 也不是硬性 OS 内存上限。

### 最终验证记录

- 定向 Electron Vitest：8 files、7 passed / 1 skipped；95 tests passed、2 skipped。
- `npm run test:worker`：86 files passed、1,251 tests passed、22 skipped。
- `npm run test:library-availability`：9 files passed、207 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts tests/e2e/image-sequence-viewer.test.ts tests/e2e/document-preview.test.ts tests/e2e/asset-pagination.test.ts tests/e2e/thumbnail-scroll-regression.test.ts`：11 passed、1 skipped（1.1m）。
- `npm run typecheck`、`npm run lint`、`git diff --check`：通过；lint 仅有 `library-service.ts` 超过 Babel 500KB 提示。
- `npm run test:perf:media-tasks -- <20k-fixture>`：1 file / 1 test passed；3×100 任务完成，资源失败 0，RSS/事件循环指标见上表。
- `npm run test:unit`：399 files passed、1 skipped；3 files failed、4 tests failed，2,940 passed、2 skipped。
  失败为 macOS canonical-path 断言、FFmpeg bundle 缺少 `lavfi` 输入格式，以及 synthetic 7-byte
  `better_sqlite3.node` package 校验，均不由本模块源码引入；不能记为 Unit 全绿。

## 2026-08-26 追加：精确可见窗口、批量忽略过滤与取消收口复测

### 本轮修改

- Renderer 的可见窗口上报现在只包含实际与画布视口相交的卡片。虚拟 overscan 卡片仍可挂载，
  但它们标记为 `deferUntilVisible`，不再和首屏真实可见卡片竞争高优先级媒体波次；远距离跳转
  仍由 Worker 的可见范围抢占和渐进补齐负责。
- `filterIgnoredAssetIds` 从逐 asset、逐忽略规则的 SQLite 往返改为每 500 个 ID 一次的
  有界 `IN` 查询，保留忽略规则语义、调用方顺序和重复 ID。可见窗口报告与 bounded queue
  fill 因此不再为 20–25 张卡片产生几十次 SQLite round-trip。
- 被新可见窗口抢占的 Sharp 任务在 abort 路径只清理临时输出并重新抛出取消信号，不再写入
  failed artifact、重复尺寸探针或误报 `LIBRARY_NOT_WRITABLE`；持久化 job 留在 queued，
  可由最新波次重新领取。

### 当前源码真实 Electron 冷基准

以下均使用同一份本地 APFS copy-on-write 隔离副本，SQLite 实际 live asset 为 19,965（目录名
为 20k），独立 `userData`，固定 10 个跳转、`all-images` 严格门禁和 5 秒观察窗；源夹具未修改。
每次测试前清除隔离副本的视觉 artifact 和遗留队列任务。命令模板为：

```bash
SERPENT_LARGE_LIBRARY_E2E_JUMPS=10 \
SERPENT_LARGE_LIBRARY_E2E_GATE=all-images \
SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS=19000 \
SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT=1000 \
SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=<isolated-20k-library> \
SERPENT_LARGE_LIBRARY_E2E_USER_DATA_PATH=<isolated-user-data> \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=<benchmark-result.json> \
npm run test:e2e:large-library-benchmark -- <20k-fixture>
```

批量忽略过滤合入后的两次独立冷跑：

| 冷跑 | 严格 500ms | 全部完成 p50 / p95 / max | first visual wave p50 / p95 / max | 观察窗最终完成 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 9/10 | 474.1 / 527.9 / 527.9 ms | 113.2 / 164.4 / 164.4 ms | 10/10 |
| 2 | 7/10 | 490.9 / 544.4 / 544.4 ms | 120.4 / 172.8 / 172.8 ms | 10/10 |

两次共 20 个跳转样本为严格 16/20，合并 p50 477.4ms、p95 527.9ms、max 544.4ms；
first visual wave 合并 p50 120.4ms、p95 164.4ms。取消清理修正前的当前源码独立冷跑曾为
严格 6/10、全部完成 p50 476.5ms、p95/max 597.9ms、first visual wave p50 128.7ms、
p95/max 151.8ms、观察窗最终 10/10；Main long-task max 0ms。加入取消等待器竞态修正后，
从同一实际 live 19,965 夹具重新清理 artifact/job 并冷启动的最新独立冷跑为严格 5/10、
全部完成 p50 496.6ms、p95/max 557.7ms、first visual wave p50 122.6ms、p95/max
161.7ms、观察窗最终 10/10；Main long-task max 0ms。冷启动尾延迟有明显 run-to-run
variance，不能把合并样本或单次 9/10 当作门禁通过。严格“全部可见图片 500ms 内完成”
仍为红灯，`Serpent-sa65` 保持 `in_progress`。

2026-08-27 的媒体 Electron 回归也按“先发现、再复测”记录：上一轮整套 12 项运行中，视频
海报快速滚动在第一个跳转的 350ms 采样点出现 2 张未解码（10 passed、1 skipped、1 failed）。
同一视频测试随后独立重复 5 次为 5/5，完整媒体集合重跑为 11 passed、1 skipped，再以
`--repeat-each=2` 重跑为 22 passed、2 skipped；没有再次复现，且失败没有 FFmpeg/资源错误证据，
因此未通过放宽断言或改用等待来掩盖它，当前源码保留原有 350ms 回归断言。

两项受控 A/B 也保留在证据中：把交互 Sharp 槽位从 4 降到 2 的同口径冷跑仅 2/10、全部完成
p50 609.8ms；禁用可见窗口抢占为 4/10、p50 510.0ms。因此保留 4 个交互槽位和即时抢占，
没有用降低并发或取消抢占掩盖尾延迟。

本轮证明了首屏队列竞争和可见窗口 SQLite 往返的真实改进方向，也证明了取消路径不再制造
伪失败 artifact；但尚未证明严格性能预算已稳定满足。100k、Windows、真实 NAS/SMB、packaged、
Computer Use/人工视觉仍未执行。

## 当前阶段结论

D.6 的动态可见范围、受限交互媒体 lane、TIFF 有界解析/双 decoder 路由、Main path-cache
竞态和 native 内存准入修复均已实现并有当前源码回归证据；严格“全部可见图片 500ms 内完成”仍未达标，因此
`Serpent-sa65`、`Serpent-3kfe` 和相关性能工单保持 `in_progress`。Windows、真实 NAS/SMB、
packaged、100k 和 Computer Use/人工视觉证据仍未执行，不能写成 accepted。
