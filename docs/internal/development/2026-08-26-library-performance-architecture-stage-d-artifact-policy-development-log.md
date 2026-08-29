# 2026-08-26 大型资源库性能架构阶段 D.1 开发日志：artifact policy 与准入

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)

本次按阶段 B 的后续顺序进入阶段 D，先完成产物策略、入队准入和 claim-time 再核对。阶段 C 浏览会话、完整 PreviewCache 预算/观测和阶段 E watcher/文件操作仍未完成。

## 根因

之前的媒体队列主要以 `job.kind` 和若干分散的 SQL `NOT EXISTS` 判断表达策略。这样有三类风险：

1. 产品角色（卡片缩略图、视频 poster、播放代理、色卡、技术元数据）和 durable job/kind 没有单一映射；同一 revision 的不同调用方容易各自实现一套去重判断。
2. 入队和实际 claim 之间存在时间窗口。文件被忽略、删除、变更 revision 或变为不可用后，旧任务仍可能拿到解码器，直到失败路径才被发现。
3. 原生源优先和“需要派生物”混在一起。视频/音频播放代理只能在真实源解码失败后生成；音频不应因进入色卡流程而产生无意义的 palette job。

## 实现与追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 角色、job kind、revision artifact kind 的单一映射 | `src/worker/artifact-policy.ts` 的 `artifactRoleForJob` / `artifactKindForJob` | `tests/unit/artifact-policy.test.ts` 5 项；Worker 缩略图/派生套件 | macOS arm64 Worker；Windows、NAS/SMB、packaged 未验证 |
| 幂等键包含 asset/revision/role/generator/settings 且分隔符安全 | `artifact-policy.ts` 的 `artifactKey` | policy 单测覆盖 revision、generator version、settings 和分隔符 | 当前数据库仍以 `(revision_id, kind)` 的兼容 schema 作为物理唯一边界；键已用于准入决策，持久化 key 列/跨 generator 的定向失效属于后续 D.2 |
| 入队前过滤 stale/unsupported/ignored/terminal/active 任务 | `LibraryService.enqueueThumbnailJobs`、`enqueueVideoMetadataJob`、`enqueuePaletteJob` | `tests/worker/thumbnails.test.ts`；完整 Worker 83 files / 1209 passed | 未执行真实 NAS 并发变化；本地 Worker 证据通过 |
| claim 后再次核对 revision、删除/忽略、availability、ready artifact、同类 single-flight | `LibraryService.processThumbnailQueue` 的 claim admission | stale revision 在 decoder 前取消测试；完整 Worker 回归 | 证明的是 Worker/SQLite 边界；跨机器同时写库未验证 |
| 原生视频/音频不预生成 playback proxy；proxy 仅显式回退 | `artifact-policy.ts`、现有 `enqueueArtifactRetry` 与 queue claim | policy 单测；现有 GIF/音频源优先回归；媒体 Electron E2E | 当前 macOS Electron 6 passed / 1 skipped；真实不支持 codec、Windows 尚未验证 |
| 显式 thumbnail retry 不被 ready-admission 误判为重复 | `LibraryService.enqueueArtifactRetry` 先精确失效 thumbnail；显式 playback fallback intent 在重试/租约丢失/重启恢复中保留 | Worker 派生/缩略图/policy 套件 74 passed | 人工重试视觉与 Windows 文件占用未验证 |

## 策略规则

- `generate_thumbnail` 对视频映射为 `video-poster`，对图片/音频/模型/文档映射为 `card-thumbnail`；文本和 unknown 不进入媒体生成队列。
- `extract_palette` 只接受 image/video/model/document；音频 waveform 使用已有视觉封面，但不因此获得自动色卡。
- `generate_webm_proxy` / `generate_audio_proxy` 在入队和 claim 时都要求显式 source-decode fallback；打开、导入、hover 本身不会产生 proxy。
- 入队和 claim 都是必要的：前者减少 durable rows，后者防止竞态任务触发昂贵 native decoder。claim 发现 ready 产物、stale revision 或 ignored/deleted 状态时，直接以明确 error code 取消，不进入失败重试环。
- `artifactKey` 目前作为策略层的稳定 identity；现有 schema 的兼容唯一索引仍是 revision+kind，相关 generator/settings 持久化和局部失效需在 D.2 单独迁移并建立旧库兼容证据。

## 验证记录

- `npx vitest run --config vitest.config.ts tests/unit/artifact-policy.test.ts`：1 file / 5 tests passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/thumbnails.test.ts tests/worker/derived-artifact-repair.test.ts tests/unit/artifact-policy.test.ts`：3 files / 74 tests passed。
- `npm run test:library-availability`：9 files / 199 tests passed。
- `npm run test:worker`：83 files passed、13 skipped；1209 tests passed、20 skipped。
- `npm run test:unit`：385 files passed、1 skipped；2860 tests passed、2 skipped，但有 4 个既有环境相关失败、分布在 3 个文件（`library-parent` 两项 macOS `/private` realpath 断言、bundled FFmpeg 缺少 `lavfi` 输入格式、`media-binaries` 测试夹具的 7-byte `better_sqlite3.node` packaged gate）。这些失败未触及本次策略代码；没有把全量单元套件写成全绿。
- `npm run typecheck`：通过。
- 改动文件 ESLint（`artifact-policy.ts`、`library-service.ts`、`artifact-policy.test.ts`）：通过。
- `node scripts/run-e2e.mjs tests/e2e/document-preview.test.ts tests/e2e/media-preview.test.ts`：首次运行 5 passed / 1 failed / 1 skipped，失败为 SVG 卡片真实解码断言超时；补充 `--repeat-each=3` 的同一图片旅程 3/3 通过，随后完整重跑 6 passed / 1 skipped。失败重跑通过只能记录为未关闭的时序敏感观察，不能当作稳定性证明；诊断信息已加入 E2E failure context。覆盖 PDF 首页/多页/缩放、HTML iframe、图片真实解码和视频失败诊断。跳过项是完整进程重启后的历史视频修复路径。
- 没有把上述 macOS/本地证据写成 20k、真实 NAS/SMB、Windows 或 packaged 性能通过；阶段 A 的 10k 冷基准限制继续有效，20k 夹具此前因 ENOSPC 未执行。

## 下一步

阶段 D.1 已完成；D.2 的持久 artifact identity、ready/failed descriptor 局部失效和
hit/miss/eviction 观测已在
[`阶段 D.2 开发日志`](2026-08-26-library-performance-architecture-stage-d2-artifact-identity-cache-development-log.md)
完成。下一步按架构顺序进入阶段 C：BrowseSession、窗口摘要、几何块和侧栏渐进 hydration。
