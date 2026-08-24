# 资源库与查看器性能优化记录

> 日期：2026-08-24
> 基线提交：`56a9e645`（`fix: 资源库性能问题分析`）
> 工单：`Serpent-29125f`
> 状态：代码与自动化基准已完成；真实 NAS、Windows、packaged 与人眼验收仍未完成

## 本轮目标

本轮以基线提交中的研究记录
[`2026-08-24-viewer-thumbnail-worker-starvation.md`](../research/2026-08-24-viewer-thumbnail-worker-starvation.md)
为实施依据。研究记录已经把问题从“数据库查询慢”收敛为单 Worker 饥饿和重复 I/O：

1. `refreshManagedAssetsOnOpen` 在 Worker 内同步递归 `readdir/lstat`，并在较长 SQLite
   事务中再次做文件对账；打开库时会阻塞消息端口。
2. 开库后台对账没有完整的 generation/close 顺序；切库或关闭时可能让旧任务继续访问
   即将关闭的连接。
3. Renderer 的 visible-window 报告受资产数组和布局重渲染影响，重复发送相同窗口；同步
   图像 header probe 在 ACK 前执行。
4. 每一个 `serpent://preview` 都可能再次请求 Worker 做 artifact path lookup。
5. 查看器的 placeholder → full upgrade 中间层再次 `fetch(src)`、`createImageBitmap`、
   canvas 转 PNG，然后还保留 full `<img>`，将源读取和解码压力叠加。
6. 实际卡片缩略图仍使用浏览器默认 lazy/解码优先级，冷视口的图片加载有明显抖动。

## 实施内容

### Worker / 资源库

- `src/worker/library-service.ts`
  - 将开库源文件发现改为 `fs/promises.opendir/lstat` 的可取消、可让步 DFS；每个短时间
    slice 让出 Worker event loop，并在每个批次前检查 generation、AbortSignal 和连接状态。
  - 一次异步发现同时提供 managed/linked 文件快照和 identity map；后续短事务只消费快照，
    不再对同一文件重复枚举和 stat。离线 linked root 不会因未扫描而被误标 missing。
  - 保留 `assetLstat` 测试 seam；生产默认走异步 lstat，测试仍可注入确定性的慢 stat。
  - 对账写入按本地盘/网络盘采用有界批次；缺失资产才走 fallback stat。
  - 默认忽略文件清理改为精确 SQL 候选 + cursor 分页 + 小事务，不再把全部可见资产加载到
    JavaScript 后过滤。
  - index warm 限定最近修改/当前 artifact 的有限页；完整 `quick_check(1)` 延后到有用的
    交互工作之后，交互活跃时明确记录 deferred。
  - `runOpenBackgroundReconciliation` 采用每库单 generation；新一代会取消旧一代。
    每个让出点持续等待到真实交互 idle window 结束，`closeLibraryAsync` 先取消并等待对账
    再备份/关连接，避免旧任务碰已关闭数据库或侵入首个跳转。
  - visible-window header dimensions 改为 `fs/promises` 异步读取，16 个一批并可取消；ACK
    不再等待打开/读取/关闭源文件。

- `src/worker/index.ts`
  - visible-window 资产 ID 排序、去重、限额并以稳定 key 幂等；同一个窗口不再重复中断/排队。
  - dimensions probe 独立队列，批间 `setImmediate`；关闭、删除和 Worker shutdown 都会取消。
  - 增加门控诊断：`SERPENT_REFRESH_STAGE_LOG=1` 输出对账阶段；
    `SERPENT_WORKER_CMD_LOG=1` 输出 command 的 queue/wait/run 时间。

- `src/worker/image-dimensions.ts`
  - 抽出共享 header parser；同步调用保持兼容，新增异步 `readImageDimensions`。

### Main / Renderer / 查看器

- `src/main/index.ts`
  - 增加按 library + artifact + usage 的 4096 项 LRU artifact path cache；cache hit 更新
    MRU，资产/库变化、关闭和删除时清理并拒绝未完成 batch waiter。
- `src/main/worker-client.ts`、`src/shared/protocol/requests.ts`
  - 在 `SERPENT_WORKER_CMD_LOG=1` 下记录 Main→Worker 的发送时间和完整 roundtrip，不改变
    默认协议行为。
- `src/renderer/App.tsx`、`src/renderer/visible-window.ts`
  - visible-window 报告 debounce 50ms + rAF，按稳定的去重集合比较；布局重建时重新 arm，
    防止 Worker 已清 key 而 Renderer 永久抑制相同窗口。
  - `loadContent` 先把首个主浏览查询和计数查询送入 Worker，再开始侧栏 hydration，避免
    文件夹/标签/合集同步查询排在用户正在等待的首屏之前。
- `src/renderer/AssetCardMedia.tsx`
  - 实际卡片缩略图使用 `decoding="async"`、`fetchPriority="high"`，仍保留 `loading="lazy"`
    和既有窗口化边界；只提高进入可见窗口的卡片请求调度，不预取整库。
- `src/renderer/zoomable-preview-image.tsx`
  - 移除重复的 `fetch(src)` + `createImageBitmap` + canvas PNG 中间层；placeholder 保持可见，
    单个 full `<img>` 完成真实解码后再切换，避免重复源读取、解码和额外 bitmap 内存。

### 混合内容测试库与 PDF 后续收口（2026-08-24）

最新 Windows 日志显示，混合内容测试库剩余长尾主要来自共享 Worker 队列被请求洪峰挤压，而不是
`asset.metadata.get` 的 SQL 点查；PDF 还叠加了自定义协议未使用 Range、首屏渲染晚于全页占位和
重复 source 请求。本轮按研究记录
[`2026-08-24-cyber-library-thumbnail-pdf-latest-log-analysis.md`](../research/2026-08-24-cyber-library-thumbnail-pdf-latest-log-analysis.md)
落地以下修复：

- 原生拖拽同步预热由 500 条缩小为 64 条，其余资产进入每批 500 条、串行且带调度间隔的后台
  队列；切库/关闭时取消队列，避免多个列表响应同时制造 Worker 请求洪峰。
- 文本卡片只在接近视口时读取摘要，并合并相同资产的并发请求；Worker 按资源库、资产、revision
  和字节上限缓存小段文本，保存文本或关闭资源库时失效。
- PDF 在 source URL 尚未返回时先显示现成缩略图；对支持 Range 的 `serpent://source` 使用
  `PDFDataRangeTransport` 按需取数，先启动首页绘制，再分批创建后续页占位并让出事件循环；
  不支持 Range 时保留完整流回退。
- 查看会话的 StrictMode 初始 effect 只允许一个 preview 请求，避免重复的首个 source 链路。

这组改动解决了已确认的请求放大和 PDF 首屏结构问题，但没有把尚未定位 owner 的 Worker 连续
7–8 秒黑洞误归因于数据库。真实 Windows/NAS 首次与二次打开、打包应用和人眼验收仍需在当前
提交上复测。

## 基准设计

基准分三层，分别回答 Worker 是否饿死、数据库/范围查询是否回归、真实 Electron 是否真的
完成图片解码。基准不会把 DOM 存在、job 成功或“最好的一次”当成通过：真实滚动必须检查
`complete && naturalWidth > 0 && naturalHeight > 0`，并记录每次跳转、long task、页面请求波次、
默认图标和占位数。

### Worker 20k 基线

夹具：`/private/tmp/serpent-large-library-perf-bqoxw4`，manifest 目标 20,000；由于此前
历史 destructive comprehensive benchmark 已从该临时库永久删除 7 项，本轮实际 live asset
数为 19,993。当前 `tests/worker/comprehensive-perf-bench.test.ts` 默认只读，删除/评分/重排
指标必须显式设置 `SERPENT_PERF_BENCH_ALLOW_MUTATION=1`，且只应对 disposable clone 使用。
本轮使用的夹具没有再删除资产。

命令：

```text
npm run test:perf:large-library -- /private/tmp/serpent-large-library-perf-bqoxw4
```

当前输出（当前提交）：

```text
{"suite":"large-library-20k","targetAssets":20000,"liveAssets":19993,
 "startupMs":9.7,"allBrowseMs":8.3,"folderSwitchMs":0.8,
 "collectionSwitchMs":1.5,"collectionRecursiveSwitchMs":28.3,
 "collectionRecursiveLayoutMs":55.6,"searchMs":21.3,"layoutMs":106.1,
 "inspectorMs":0.1}
```

同一套 Worker 测试新增完整开库对账并发 viewer resolve：

```text
{"suite":"large-library-20k-reconciliation-viewer","targetAssets":20000,
 "liveAssets":19993,"reconciliationMs":3040.5,
 "eventLoopLagP95Ms":2.1,"eventLoopLagMaxMs":83.0,
 "viewerResolveP50Ms":0.5,"viewerResolveP95Ms":1.3,
 "viewerResolveMaxMs":13.8,"viewerSamples":93}
```

该层明确只证明 Worker 请求不被对账同步代码饿死，不把它冒充 NAS 源文件读取或浏览器
decode 证据。

### 对账事件循环压力基准

命令：

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/reconciliation-performance.test.ts \
  --disableConsoleIntercept
```

测试创建 1,200 个文件，并通过既有 `assetLstat` seam 注入每文件 0.25ms 的慢 stat，
用 5ms interval 采样事件循环 lag，同时覆盖“开始对账后立即 close”的取消/重开路径。

当前输出：

```text
RECONCILIATION_PERF_JSON {"fileCount":1200,"discoveredAssetCount":1200,
 "elapsedMs":673.3,"eventLoopLagP95Ms":13.2,"eventLoopLagMaxMs":24.0}
5 files / 81 tests passed，另有 1 个文件、2 个测试跳过（含 ignore 规则、watcher、thumbnail 与 viewer latency 回归）
```

旧同步递归实现的同一 starvation 测试曾测得 `eventLoopLagP95Ms=569.3`、
`eventLoopLagMaxMs=569.3` 并失败；当前 hard gate 为 p95 lag <25ms 且 max lag <150ms，
并另有“交互 idle window 未结束前对账不进入同步阶段”的回归断言。

### 真实 Electron 20k 滚动解码基准

命令（每次使用隔离 userData，复用同一 operator-managed fixture，不复制 29GB 资产）：

```text
SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY=/private/tmp/serpent-large-library-perf-bqoxw4 \
SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=/private/tmp/serpent-large-library-e2e-result-final-1.json \
node scripts/run-e2e.mjs tests/e2e/large-library-scroll-benchmark.test.ts
```

固定 10 个跳转：`0.11 → 0.83 → 0.37 → 0.69 → 0.22 → 0.77 → 0.46 → 0.61 → 0.15 → 0.54`；
目标 500ms；每个视口约 22–24 张卡片。结果对比：

| 状态 | 通过 | P50 | P95 / Max | 备注 |
| --- | ---: | ---: | ---: | --- |
| 基线（本轮改动前） | 8/10 | 412.5ms | 665.3ms | 真实解码；9/10 与 10/10 均未达成 |
| 对账/visible-window/viewer 改动后 | 10/10 | 102.9ms | 478.4ms | 下一轮独立冷启动为 9/10、512.6ms，不能算稳定通过 |
| 再加卡片 async decode + high priority | 10/10 | 110.8ms | 412.4ms | 独立复测 |
| 再加卡片 async decode + high priority（独立第二轮） | 10/10 | 96.9ms | 312.7ms | 独立复测 |
| 当前 HEAD 冷启动（独立第一轮） | 10/10 | 110.5ms | 350.0ms | `final-1.json`；真实解码、占位 0、long task 0 |
| 当前 HEAD 冷启动（独立第二轮） | 10/10 | 100.0ms | 463.5ms | `final-2.json`；真实解码、占位 0、long task 0 |
| 当前 HEAD 冷启动（独立第三轮） | 10/10 | 95.7ms | 316.7ms | `final-3.json`；真实解码、占位 0、long task 0 |
| 当前 HEAD 冷启动（独立第四轮） | 10/10 | 109.0ms | 420.2ms | `final-4.json`；真实解码、占位 0、long task 0 |
| 当前 HEAD 冷启动（独立第五轮） | 10/10 | 103.1ms | 222.6ms | `final-5.json`；真实解码、占位 0、long task 0 |
| 当前 HEAD 冷启动（独立第六轮） | 10/10 | 111.1ms | 224.6ms | `final-6.json`；真实解码、占位 0、long task 0 |
| 当前 HEAD 冷启动（独立第七轮） | 10/10 | 90.4ms | 395.8ms | `final-7.json`；真实解码、占位 0、long task 0 |

当前 HEAD 的七轮最终结果均为 10/10，真实图片卡片的 `naturalWidth/naturalHeight` 非零；测试同时记录
无 long task、占位为 0，并允许非图像资产保留 themed default icon。对账 idle-window 修复前的
单次 9/10（首跳 534.8ms）和单跳诊断 513.5ms 被保留为证据，促成了对账真正避让交互的修复，
没有调高 timeout 或隐藏 loading 来绕过。

## 自动化验证

已执行：

```text
npm run typecheck
# 通过

npm run lint
# 通过（exit 0；仅有 Babel 对超大 library-service 文件的 deoptimised 提示）

npm run test:perf:large-library -- /private/tmp/serpent-large-library-perf-bqoxw4
# 1 file / 2 tests passed；20k 浏览、递归范围、开库对账并发 viewer 均通过
# 当前结果：startup 9.7ms，all browse 8.3ms，layout 106.1ms；并发 viewer P95 1.3ms，event-loop lag P95 2.1ms / max 83.0ms

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/reconciliation-performance.test.ts \
  tests/worker/large-library-performance.test.ts tests/worker/thumbnails.test.ts \
  tests/worker/viewer-preview-latency.test.ts tests/worker/media-ignore-scheduling.test.ts \
  tests/worker/library-watcher.test.ts --disableConsoleIntercept
# 5 files passed / 1 skipped；81 tests passed / 2 skipped
# RECONCILIATION_PERF_JSON：1,200 文件，event-loop lag P95 13.2ms / max 24.0ms，耗时 673.3ms

npx vitest run tests/unit/visible-window.test.ts \
  tests/unit/zoomable-preview-image-fallback.test.ts \
  tests/unit/viewer-mip-upgrade.test.ts tests/unit/browse-pagination.test.ts
# 4 files / 22 tests passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/library-availability.test.ts \
  tests/worker/library-schema-readonly.test.ts \
  tests/worker/database-recovery.test.ts tests/worker/schema-failure.test.ts \
  tests/worker/schema-compatibility.test.ts tests/worker/schema-downgrade-chain.test.ts \
  tests/worker/schema-lenient-read.test.ts tests/worker/migration-discipline.test.ts \
  tests/worker/library-service.test.ts
# 9 files / 199 tests passed
```

完整 `npm run test:unit` 当前得到 `379 files passed / 2817 tests passed`，另有 1 个文件跳过、
2 个测试跳过，以及 5 个既有环境/基线失败：macOS `/private` 临时路径断言 2 个、UI Escape
测试 1 个、ffmpeg lavfi 编码环境 1 个、packaged native `better_sqlite3.node` 校验 1 个。
它们不在本次变更路径；没有删除或放宽测试。

`tests/e2e/media-preview.test.ts` 的 viewer 旅程本次连续两次停在既有的
`getByLabel("自动色卡预览")` 15 秒等待，未进入后续查看器断言；因此本轮不把该 E2E 写成
通过。单元/Worker viewer latency 与真实 20k 滚动解码基准仍分别提供了可追溯证据。

## 四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 开库对账不阻塞首屏/查看器 | `src/worker/library-service.ts`：`runOpenBackgroundReconciliation`、`yieldReconciliation`、`enumerateSourcesAsync`；`src/renderer/App.tsx` 首屏请求排序 | `tests/worker/reconciliation-performance.test.ts`；`tests/worker/large-library-performance.test.ts` 并发 viewer benchmark；真实 Electron 20k 七轮严格滚动 | macOS Electron/本地临时 20k 已执行；真实 SMB/NAS、Windows、packaged、Computer Use 未执行 |
| 对账可取消且关闭后不访问旧 DB | `src/worker/library-service.ts`：generation、`closeLibraryAsync`；`src/worker/index.ts` shutdown/cancel | reconciliation cancellation test；library-availability 9/199 | 本地完整退出/重开单元边界已覆盖；真实 UtilityProcess kill/restart、NAS 断开未执行 |
| visible-window 不重复调度且 header probe 不在 ACK 前阻塞 | `src/renderer/App.tsx`、`src/renderer/visible-window.ts`、`src/worker/index.ts`、`src/worker/image-dimensions.ts` | visible-window unit；thumbnails header-probe；media-ignore；reconciliation performance | 真实 20k Electron 滚动已执行；人工滚动视觉、Windows、SMB 未执行 |
| artifact path lookup 有界缓存且关闭失效安全 | `src/main/index.ts`：artifact path LRU/batch cancellation | viewer-preview-latency、large-library Electron scroll（真实 `serpent://preview` decode） | 本地 macOS Electron 已执行；NAS 冷/热 cache、Windows、packaged 未执行 |
| 查看器/卡片不重复 full decode，冷视口优先调度 | `src/renderer/zoomable-preview-image.tsx`、`src/renderer/AssetCardMedia.tsx` | zoomable source invariant；viewer-mip 单测；真实 20k scroll benchmark 七轮 | 七轮 macOS 开发态 Electron 基准；真实大图 NAS 首次/二次打开、Computer Use 未执行 |

## 未完成与后续

- 不能把本地 APFS 的 10/10 当作 Windows/NAS 发布结论；工单继续 `in_progress`。
- 需要在真实 SMB/NAS 上执行同一基准的首次/二次打开，并启用
  `SERPENT_VIEWER_TIMING_LOG=1`、`SERPENT_WORKER_CMD_LOG=1`，对比源读取、协议响应、
  Worker queue 和 PDF/视频解析阶段。
- 需要用当前 HEAD 重新 package 后复跑 packaged 20k smoke；本轮没有使用旧包替代当前
  HEAD 证据。
- `Computer Use`/人类视觉验收未执行，`LIB-PERF-004`、`VIEWER-PERF-002` 保持“待人类
  验收”，不标记为人类通过。
