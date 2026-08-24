# 媒体任务资源安全与查看器性能开发日志

## 基本信息

- 范围：`Serpent-235f69`（全格式媒体资源限制审计）、`Serpent-9imk.1`（导入与媒体任务收口）、`Serpent-308675`（高负载 lease-lost）。
- 分支：`dev`。
- 审查基线：`353f4d9a`（本轮修改前的当前提交）。
- 目标：缩略图优先追求速度和主窗口可交互性；允许降低缩略图质量，但不能让高分辨率视频/图片解码把 Worker、主窗口或操作系统内存推入压力状态。
- 状态：实现与定向自动化完成；主线全量门禁仍有独立基线失败，平台/人工验收未完成。

## 事故证据与根因

对导入失败日志的脱敏汇总：13 个 JSONL 文件、2,824 行记录；没有发现 V8 heap OOM，直接证据是系统/原生资源压力：`spawn ENOMEM`、FFmpeg `Cannot allocate memory`、`get_buffer() failed`、30 次 `spawn UNKNOWN`、17 次 lease-lost、403 次请求超时和 387 次迟到响应。

根因不是单个 TIFF 限制，而是多个原生解码器同时扩大资源峰值：

1. 原先的并发按物理 CPU 推导，在高核机器上会同时启动多个 FFmpeg/Sharp/OIIO 工作；每个库还有自己的线程池和帧缓冲。
2. 视频海报使用 `thumbnail=300,scale=640:-1`，FFmpeg 先保留高分辨率帧批次再缩放；长视频或大帧会把单个子进程的峰值放大。
3. 导入的同步文件/数据库路径与媒体任务争用同一个 Worker；当 Worker 事件循环、心跳和进程创建同时拥塞时，lease-lost 会把压力进一步放大。
4. `spawn UNKNOWN` 同时出现在不支持的 OIIO RAW 输入中，不能把它泛化为 OOM，否则会掩盖真实格式错误。

## 实现决定

### 1. 全局原生资源预算

- `src/shared/media-concurrency.ts:8-19` 将媒体队列固定为最多 2 个；单核机器仍保留 1 个。
- `src/worker/library-service.ts:3691-3702` 对所有打开库共享预算：Sharp 最多 2 个，FFmpeg 1 个，OIIO 1 个；不再随 CPU 核心数扩张。
- `requireSharp()` 将 libvips 文件缓存关闭、内存缓存压到 32MB、条目缓存限制为 128，并将 Sharp 内部并发设为 1。
- `src/worker/library-service.ts:347-362` 对 FFmpeg 解码/滤镜默认补上 `-threads:v 1`、`-filter_threads 1`、`-filter_complex_threads 1`；ffprobe 不增加这些参数，因为它只负责短元数据探针。

### 2. 快速海报路径

`src/worker/library-service.ts:20678-20735` 的视频海报现在：

- 只选视频流，禁用音频、字幕和 data stream；
- 先把帧缩到长边 640，再执行 `thumbnail=30`，减少 FFmpeg 保留的全分辨率帧数量；
- 只输出一帧 JPEG，`q:v 3`；
- 质量让位于速度、峰值内存和卡片首屏可用性。

### 3. 资源压力识别、熔断和退避

`src/worker/media-resource-guard.ts:1-139` 只接受明确的 allocator 文案、`ENOMEM` 或已知进程启动压力状态码；明确拒绝把普通 codec 错误和 Windows `spawn UNKNOWN` 当作 OOM。

- 第一次资源压力后暂停新的媒体 claim 30 秒；连续失败按 30 秒、60 秒、120 秒……退避，最大 5 分钟。
- 资源错误统一为 `MEDIA_RESOURCE_EXHAUSTED`，任务回到 queued 并保留可操作的用户提示和本地诊断。
- 导入/链接等同步文件操作使用 external hold，暂停新的原生媒体 claim，不强行中断已经受预算约束的解码器。
- 成功完成会清理连续失败计数；关闭库、删除库和 Worker 退出会取消重试 timer。

### 4. 主预览优先、次级派生渐进

- `src/worker/library-service.ts:24038-24167` 在 claim 时阻止同一 asset/revision 的 contact sheet、WebM/audio proxy 抢在 thumbnail/video poster 前；metadata probe 不被阻塞。
- `src/worker/index.ts:1026-1130` 将 metadata、palette 和代理放到交互空闲后的单任务队列；普通次级任务一次只取一个。
- 查看器明确请求 WebM/audio fallback 时使用 urgent queue（`src/worker/index.ts:3325-3337`），绕过空闲窗口但仍经过 FFmpeg 单槽位。
- `asset.derived.ready` 通过严格 IPC schema（`src/shared/protocol/responses.ts:423-440`）通知 Renderer；`src/renderer/App.tsx:3416-3425` 只刷新当前 Inspector 的派生信息，不重载整页卡片。
- 主预览完成后只在同一 asset/revision 确有等待中的次级 FFmpeg job 时提前 flush；普通图片批次继续采用每个 Worker 一次的批量提交，避免为修复依赖顺序而退化吞吐。
- 查看器保持 source-first；真实播放失败后才启动单资产 proxy 请求，并保留已解码的当前媒体直到替代源 ready（`src/renderer/AssetPreviewModal.tsx:234-327`）。

## 自动化与基准

新增 `tests/worker/media-task-performance.test.ts:320-423` 和 `scripts/run-media-task-performance.mjs`：从 20,000 资产混合夹具抽取包含图片、视频和其他格式的 100 个资产，连续 3 轮删除视觉派生物、重新排队、处理并采样 Worker 进程树 RSS 与事件循环延迟；测试只操作 disposable clone，结束后清理 clone。该基准是 opt-in，避免普通单元测试隐式消耗几十 GB 的 fixture。

当次当前 HEAD 结果：

| 指标 | 结果 |
| --- | --- |
| 20,000 资产夹具 | 识别 20,000；每轮 100 个资产 |
| 完成率 | 3/3 轮均 100/100；资源压力失败 0 |
| 吞吐 | 14.48/s、15.73/s、15.73/s |
| RSS 增量 | 146.9MB、88.7MB、63.4MB；门槛 768MB |
| 事件循环最大延迟 | 29.3ms、22.4ms、19.2ms；门槛 250ms |
| 资源库浏览/查看器基准 | 20k 库测试通过；reconciliation 1,195.6ms，event-loop p95 1.4ms，viewer resolve p95 2.6ms |

## 当次验证记录

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/thumbnails.test.ts tests/worker/video-exr.test.ts tests/worker/thumbnail-throughput.test.ts tests/worker/real-media-bundle.test.ts`：4 个文件、118 个测试通过。
- `npm run test:library-availability`：9 个文件、199 个测试通过。
- `npm run test:perf:media-tasks -- <20k-fixture>`：1 个文件、1 个测试通过，结果见上表。
- `npm run test:perf:large-library -- <20k-fixture>`：1 个文件、2 个测试通过。
- `node scripts/run-e2e-isolated.mjs tests/e2e/media-preview.test.ts`：2 passed、1 skipped；图片断言 `complete && naturalWidth > 0`，跳过项依赖不可用的历史媒体修复资源。
- `node scripts/run-e2e-isolated.mjs tests/e2e/media-video-playback.test.ts`：1 passed；验证直接 MP4 与生成的 WebM fallback 均实际到达媒体播放状态。

## 主线门禁结果与未完成范围

当次 `npm run verify:mainline` 在 lint、typecheck、extension verify 和资源库可用性门禁后，完整 `npm run test` 结果为 480 个测试文件中 460 个通过、14 个跳过、6 个文件 7 个失败。失败项均未触及本轮媒体实现的定向路径：

- migration checksum snapshot 仍只含 v1–v39，而当前迁移已到 v43；
- reconciliation p95 为 27.6ms，超过该测试的 25ms 主机调度阈值；
- 本机 bundled FFmpeg 不含 `lavfi`，导致合成大库视频 fixture 不能生成；
- macOS 临时路径 `/private/var` 与测试期望 `/var` 不一致；
- packaged `better_sqlite3.node` 为 7 bytes，触发既有 native rebuild 门禁；
- UI pattern 测试以 undefined event 调用 dialog handler，触发 `ime-safe-dismiss` 的既有测试替身问题。

因此本轮不能写成 `verify:mainline` 全绿或发布完成。Windows、SMB/NAS、packaged 当前 HEAD、真实大库人工操作、Computer Use 截图以及用户本人验收均未执行，仍保留在 QA 和人类验收队列。

## 重要入口

- 预算与错误分类：`src/shared/media-concurrency.ts`、`src/worker/media-resource-guard.ts`。
- 解码器与任务队列：`src/worker/library-service.ts`、`src/worker/index.ts`。
- 查看器回退：`src/renderer/AssetPreviewModal.tsx`、`src/renderer/App.tsx`。
- 回归与基准：`tests/unit/media-concurrency.test.ts`、`tests/worker/video-exr.test.ts`、`tests/worker/media-task-performance.test.ts`、`tests/e2e/media-preview.test.ts`、`tests/e2e/media-video-playback.test.ts`。
- 对应 QA：[2026-08-25 媒体任务 QA](../qa/2026-08-25-media-task-memory-safety-qa.md)。
