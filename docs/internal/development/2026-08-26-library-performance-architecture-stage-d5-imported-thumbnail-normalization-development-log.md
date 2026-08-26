# 2026-08-26 大型资源库性能架构阶段 D.5 开发日志：外部库缩略图归一化

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  
关联工单：`Serpent-688714`、`Serpent-sa65`、`Serpent-04ba9d`

## 目标与根因

Eagle/Billfish 转换原先把外部缩略图原样复制为 ready artifact。这样导入提交很快，
但 PNG/JPEG 的像素尺寸和字节量可能远超 Serpent 自身的 512 fit-inside 策略，导致
可见窗口尾部解码时间和 NAS/SMB 读取量被放大。D.5 保留“导入先可见”的快速复制，
把大图压缩移到低优先级、可取消、可恢复的媒体任务中。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 新导入的超尺寸 Eagle/Billfish 预览进入后台归一化，且重复调度幂等 | `src/worker/imported-thumbnail-policy.ts`、`src/worker/library-service.ts` 的 `insertCopiedEagleThumbnail` 与 `enqueueImportedThumbnailNormalizationJobs` | `tests/unit/imported-thumbnail-policy.test.ts` 4 passed；Worker 测试验证导入即入队、取消后存量 backfill、Eagle/Billfish 共用队列 | macOS Electron Worker：新增测试 4/4；真实 2 万 Eagle 用户库尚未执行 |
| 512 fit-inside、透明图保留 WebP、非透明图使用 JPEG；动图保留原始动画 artifact，不压平成静帧 | `normalizeImportedThumbnailArtifact`；`IMPORTED_THUMBNAIL_GENERATOR`；`artifactIdentityForPersistedRow` | `imported-thumbnail-normalization.test.ts` 8 项：Eagle/Billfish 图片与视频 poster 输出可解码且 ≤512；GIF/WebP 均保持 2 页，重开资源库、显式可见波和普通波均不重复入队，并校验 marker identity | 合成高熵 JPEG 64 个：64/64 成功，当前输出均由 Sharp 头部验证；真实用户库动图样本未执行 |
| 转换失败不破坏旧 ready artifact；崩溃/竞争时单事务替换并可重试 | `normalizeImportedThumbnailArtifact`：临时文件 → rename → 校验旧 artifact 身份 → 单事务失效/插入 → 删除旧文件；`retryMediaJobs` 保留归一化标记 | Worker 测试模拟 Sharp 失败，确认旧文件仍在、旧 generator 仍 ready、job failed；重试后 marker 保留并回到 queued | 自动化证明失败保护和重试语义；真实进程在 rename/事务边界崩溃后的恢复仍未做独立 E2E |
| 存量库只在后台有限批次修复，不阻塞可见窗口 | `enqueueImportedThumbnailNormalizationJobs`：默认最多 256，跳过 visible `skipStaleRepair` 波；ready/source-direct prune 排除专用 marker | Worker 测试取消导入 job 后调用 `enqueueThumbnailJobs`，只补回一个 normalization job；既有 `eagle-import`/`billfish-import`/`thumbnails` 81 项通过 | 本地合成库的幂等行为已验证；NAS/SMB 空闲车道、Windows、packaged 未验证 |

## 资源边界与并发语义

- 原样复制仍沿用外部缩略图 32 MiB 文件上限；归一化 Sharp 输入限制为 32 MP，输出长边
  不超过 512。所有 Sharp 工作共享现有 `sharpDecoderSemaphore`，不会因为存量修复额外
  扩大 native 并发或把完整源视频交给解码器。
- 归一化 job 使用现有 `generate_thumbnail` 类型和专用 `error_code` marker，避免 schema
  迁移；视频资产按 `video_poster` 替换，图片资产按 `thumbnail` 替换。
- 旧 artifact 在转换完成前一直是当前 ready 行；新文件写入失败、取消、旧行已被别的
  revision/任务替换时只清理临时输出，不删除旧预览。
- 动图不创建替换文件，而是在同一事务中写入 `generator_version`、`artifact_role`、
  `generator_id`、`settings_hash` 和 `artifact_key`；普通波的 GIF metadata 补偿逻辑排除
  该 durable marker，避免“metadata 缺失”把已保留的动画重新打回队列。
- `revision_artifacts.width/height` 继续表示源媒体尺寸（而不是 512 输出尺寸），缺失时
  不凭缩略图输出伪造源几何；物理输出尺寸由 Sharp 头部约束并在测试中验证。

## 性能基准

手工基准命令（Electron Node ABI，合成高熵 1600–2000px JPEG 外部预览；不是用户库替代）：

```bash
env SERPENT_IMPORTED_THUMBNAIL_BENCH=1 \
  SERPENT_IMPORTED_THUMBNAIL_BENCH_ASSETS=24 \
  SERPENT_IMPORTED_THUMBNAIL_BENCH_RESULT_PATH=/path/to/isolated-temp/serpent-import-thumbnail-bench-result.json \
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/imported-thumbnail-benchmark.test.ts
```

结果：24/24 成功，260.2 ms，总处理约 10.8 ms/asset；原始复制预览 37,598,748 bytes，
归一化后 729,139 bytes，减少 98.06%；RSS 增量 16.2 MiB。

压力复测：同一命令把 `SERPENT_IMPORTED_THUMBNAIL_BENCH_ASSETS` 改为 `64`，结果为
64/64 成功，675.1 ms（10.5 ms/asset）；原始 100,075,722 bytes → 1,952,091 bytes，
减少 98.05%；RSS 增量 27.9 MiB。该基准只证明当前 macOS 开发态合成输入的 bounded
处理行为，不能替代 20k/真实 Eagle 用户库、Windows、NAS/SMB 或 packaged 证据。

## 验证记录

- `npx vitest run --config vitest.config.ts tests/unit/imported-thumbnail-policy.test.ts`：
  1 file / 4 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/imported-thumbnail-normalization.test.ts`：
  1 file / 8 passed；覆盖 animated GIF/WebP 的 2 页保留、完整 artifact identity、关闭后重开、
  显式可见波/普通波和缺失 metadata 时的补偿排除。
- 同一 Electron Worker 命令运行 `imported-thumbnail-normalization.test.ts`、
  `eagle-import.test.ts`、`billfish-import.test.ts`、`thumbnails.test.ts`：4 files / 81 passed。
- `npm run typecheck`：通过；定向 ESLint（library-service、策略、Worker/单测）：通过；
  `git diff --check`：通过。
- `npm run test:library-availability`：9 files / 203 passed。
- `npm run test:worker`：85 files passed、14 skipped；1,232 tests passed、21 skipped（60.22s）。
- `npm run typecheck`、`npm run lint`、`git diff --check`：通过；Lint 仅报告
  `library-service.ts` 超过 Babel 500 KB 优化阈值的提示，不是错误。
- `npm run test:library-availability`：9 files / 203 passed（14:20:50 开始，6.82s）。
- 真实 Electron 外部库导入 E2E、真实 Eagle/Billfish 大库、NAS/SMB、Windows 和 packaged
  证据仍未执行，不能将合成 Worker 证据写成平台验收通过。

## 2026-08-26 校正审查结论

Luna High 校正审查发现原日志仍描述旧的 `page:0` 静帧策略；实现已统一为：多页 GIF/WebP
直接保留外部 ready artifact，归一化 job 只完成 marker，不生成替换文件。source 和廉价
artifact path 查询进入 `interactive-control`；真正可能触发插件/RAW/OIIO/ICO 解码或写入
viewer artifact 的 preview resolution 保持 `viewer-upgrade`，避免错误占用廉价查询车道。
deadline 的 admission 副作用移动到 scheduler 确认请求仍有效之后。上述行为已补定向测试，
真实动图用户库及跨平台证据仍未执行。

## 未完成与下一步

`Serpent-688714` 的代码路径、失败保护、marker identity 和合成基准已完成；本轮资源库可用性
门禁与完整 Worker 回归已通过。但真实 Eagle/Billfish 大库的存量修复尾延迟、NAS/SMB 读取、
Windows/packaged 兼容、进程级崩溃恢复和真实动图矩阵仍未验证。严格 500 ms 全部可见图片门禁
的证据仍以 D.6 的 20k 本地夹具为限，不能关闭 `Serpent-sa65` 或 `Serpent-688714`。
