# 媒体任务资源安全与查看器性能 QA

## 范围与结论

- 被测分支：`dev`。
- 被测基线：`353f4d9a` 加本轮工作树修改。
- 环境：macOS arm64 开发态、Node 24、Electron 原生测试运行器；所有 Electron E2E 使用隔离临时 `SERPENT_E2E_USER_DATA_PATH`，后台串行执行。
- 结论：有条件通过。媒体资源上限、OOM 分类/退避、缩略图优先、代理回退和资源库底线均有当前 HEAD 的定向证据；完整主线测试仍受 7 个非本轮媒体路径失败阻断，Windows、packaged、SMB/NAS 和人工视觉验收未执行。

## 四列可追溯矩阵

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 高核机器不能把所有 CPU 转成原生解码并发 | `src/shared/media-concurrency.ts:8-19`；`src/worker/library-service.ts:3691-3702` | `tests/unit/media-concurrency.test.ts:14-33`；Worker 118/118 | macOS 开发态基准通过；Windows/packaged 未执行 |
| FFmpeg 单进程/滤镜线程有上限 | `src/worker/library-service.ts:347-362,5981-6023` | `tests/worker/video-exr.test.ts:58-75,426-440` | 真实媒体 bundle smoke 在 `real-media-bundle` 通过；跨平台未执行 |
| 视频海报快速、低内存并优先于 proxy | `src/worker/library-service.ts:20678-20735,24092-24135` | `tests/worker/video-exr.test.ts:400-490`；`thumbnail-throughput.test.ts`；真实媒体 bundle | `media-preview` 2 passed/1 skipped；播放 E2E 1 passed |
| 原生资源压力被准确识别，不误报普通 `spawn UNKNOWN` | `src/worker/media-resource-guard.ts:1-76` | `tests/unit/media-concurrency.test.ts:62-101`；`video-exr.test.ts:478-510` | 日志根因分析确认 UNKNOWN 同时来自 unsupported OIIO，故保守分类；Windows 状态码未在 Windows 实机执行 |
| 资源压力暂停新 claim 并退避重试 | `src/worker/media-resource-guard.ts:79-139`；`src/worker/index.ts:574-625`；`library-service.ts:24509-24545` | `video-exr.test.ts` 资源压力重排队/冷却测试；媒体基准 3 轮资源失败 0 | 没有可复现的真实用户 OOM 进程现场；当前 macOS 压力模拟通过 |
| 导入期间不新增媒体压力 | `src/worker/index.ts:574-601,2203-2277` | `tests/unit/media-concurrency.test.ts:89-101`；资源库可用性 199/199 | 真实长时导入、Windows、NAS 未执行 |
| 次级 metadata/palette/proxy 不阻塞首屏，并通知 Inspector | `src/worker/index.ts:1026-1130`；`src/shared/protocol/responses.ts:423-440`；`src/renderer/App.tsx:3416-3425` | `tests/worker/video-exr.test.ts` poster-before-secondary/derived tests；`tests/e2e/media-preview.test.ts` | 真实 Electron 首屏/Inspector 路径通过；Computer Use 未执行 |
| source-first，播放失败才按需 proxy，明确 proxy 成功状态 | `src/worker/index.ts:3325-3337`；`src/renderer/AssetPreviewModal.tsx:234-327` | `tests/e2e/media-video-playback.test.ts:290-330`；`tests/worker/video-exr.test.ts` | 直读 MP4 与 WebM fallback 当前 macOS E2E 通过；不支持编码的真实用户素材需人工复验 |
| 20k 资源库有可重复的内存/事件循环基准 | `tests/worker/media-task-performance.test.ts:320-423`；`scripts/run-media-task-performance.mjs` | 100 assets × 3 rounds：300/300 完成、资源失败 0 | 20k 混合夹具 macOS 开发态通过；完整 20k 全量转码不作为每次 CI 操作 |

## 当次命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `git diff --check` | 通过 |
| Worker 媒体定向 4 文件 | 118/118 通过 |
| `npm run test:library-availability` | 9 文件、199/199 通过 |
| `npm run test:perf:media-tasks -- <20k-fixture>` | 3 轮各 100/100；吞吐 14.48–15.73/s；RSS 增量最高 146.9MB；最大 event-loop lag 29.3ms；资源失败 0 |
| `npm run test:perf:large-library -- <20k-fixture>` | 2/2 通过；browse 5.8ms、search 15.7ms、viewer resolve p95 2.6ms |
| `node scripts/run-e2e-isolated.mjs tests/e2e/media-preview.test.ts` | 2 passed、1 skipped |
| `node scripts/run-e2e-isolated.mjs tests/e2e/media-video-playback.test.ts` | 1 passed |

## 失败与处置

`npm run verify:mainline` 的最终结果不是全绿：460 passed、14 skipped、7 failed。失败项为 migration checksum v40–v43 快照缺失、reconciliation p95 27.6ms、bundled FFmpeg 缺少 `lavfi`、macOS `/private/var` 路径断言、packaged native module 7 bytes、UI dialog 测试替身 undefined event。它们没有改变本轮媒体定向测试的结论，但在这些问题处理前不能把主线标为发布绿；本轮不借修媒体任务之名修改无关门禁。

## 平台和人工矩阵

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| macOS arm64 开发态 Worker/单测 | 已执行 | 资源库可用性、媒体 Worker、基准均有当次命令结果 |
| macOS arm64 真实 Electron | 已执行 | 两个媒体 E2E 使用隔离 userData；媒体解码断言通过 |
| macOS packaged 当前 HEAD | 未执行 | `verify:mainline` 的 packaged native gate 被 7-byte better_sqlite3 阻断 |
| Windows | 未执行 | 当前环境无 Windows runner；不能推断 Windows spawn/路径/编码结论 |
| SMB/NAS | 未执行 | 20k fixture 是本地 disposable 数据，不能替代网络文件系统 |
| Computer Use/人眼视觉 | 未执行 | 当前会话没有可用的桌面控制/截图验收证据 |
| 用户本人功能验收 | 待执行 | 已更新 `human-acceptance-checklist.md`，保持“待人类验收” |

## 清理与隐私

媒体基准只在 disposable clone 上运行，并在测试 teardown 关闭 Worker、删除 clone。提交文档不包含用户日志、资源库名称、个人路径或测试凭据；本机生成的 E2E/测试临时产物在确认无进程占用后清理。
