# 2026-08-26 大型资源库性能架构阶段 D.5 开发日志：外部库缩略图归一化

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  
关联工单：`Serpent-688714`、`Serpent-sa65`、`Serpent-04ba9d`

## 目标与根因

Eagle/Billfish 转换原先把外部缩略图原样复制为 ready artifact。这样导入提交很快，
但 PNG/JPEG 的像素尺寸和字节量可能远超 Serpent 自身的 512 fit-inside 策略，导致
可见窗口尾部解码时间和 NAS/SMB 读取量被放大。D.5 保留“导入先可见”的快速复制，
把预览验证与大图压缩移到低优先级、可取消、可恢复的媒体任务中；即使预览看起来已经
很小，也必须在后台完成实际像素解码后才能记录为永久合规。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 每个新导入的 Eagle/Billfish 外部预览先复制为 ready，再进入后台验证/归一化；重复调度幂等 | `src/worker/library-service.ts:37666-37702`、`:26811-26930` 的导入与 backfill | `tests/unit/imported-thumbnail-policy.test.ts:12-50`、`tests/worker/eagle-import.test.ts:152-159`、`tests/worker/billfish-import.test.ts:138-149`、`tests/worker/imported-thumbnail-normalization.test.ts:292-326` | macOS Electron Worker：定向 6 files / 47 passed；真实 2 万 Eagle 用户库尚未执行 |
| 512 fit-inside、透明图保留 WebP、非透明图使用 JPEG；动图保留原始动画 artifact，不压平成静帧；输出 ≤256 KiB | `src/worker/library-service.ts:20222-20568` 的 `normalizeImportedThumbnailArtifact` 与 identity 更新 | `tests/worker/imported-thumbnail-normalization.test.ts:327-378`、`:562-718`、`:720-769` | 3 轮 × 64 个合成混合预览：每轮 64/64 成功；真实用户库动图样本未执行 |
| 转换失败不破坏旧 ready artifact；资源耗尽、lease 丢失、重启和竞争可恢复 | `src/worker/library-service.ts:20580-20645`、`:28169-28470`：rename/事务替换、取消、重试和 stale revision | `tests/worker/imported-thumbnail-normalization.test.ts:440-478`、`:771-925`、`:1065-1300` | 自动化覆盖状态恢复和失败保护；真实进程在 rename/事务边界崩溃后的恢复仍未做独立 E2E |
| 存量库只在后台有限批次修复，不阻塞可见窗口 | `src/worker/library-service.ts:26859-26931`、`:27791-27808`：默认最多 256 与 interactive guard | `tests/worker/imported-thumbnail-normalization.test.ts:484-514`、`tests/worker/imported-thumbnail-benchmark.test.ts:265-278` | 本地合成库已验证；NAS/SMB 空闲车道、Windows、packaged 未验证 |

## 资源边界与并发语义

- 原样复制仍沿用外部缩略图 32 MiB 文件上限；归一化 Sharp 输入限制为 32 MP，输出长边
  不超过 512、字节数不超过 256 KiB。所有 Sharp 工作共享现有 `sharpDecoderSemaphore`，
  不会因为存量修复额外扩大 native 并发或把完整源视频交给解码器。
- 归一化 job 使用现有 `generate_thumbnail` 类型和专用 `error_code` marker，避免 schema
  迁移；视频资产按 `video_poster` 替换，图片资产按 `thumbnail` 替换。marker 是任务身份，
  资源耗尽、lease 忙/丢失、暂停恢复和启动恢复只能更新 `error_detail` 或保留该 marker，
  不能用可变错误原因覆盖它。
- 旧 artifact 在转换完成前一直是当前 ready 行；新文件写入失败、取消、旧行已被别的
  revision/任务替换时只清理临时输出，不删除旧预览。
- 导入阶段不读取源尺寸来决定预览是否合规，也不在复制阶段做同步解码；每个副本都在
  低优先级 job 中先调用 Sharp metadata，再逐页实际解码（单页单 buffer，最多 128 页）。
  只有验证成功后才写入 `preserved-bounded`/`preserved-animated` durable marker；截断或
  损坏文件保持旧 ready 副本并进入可重试失败状态。
- 动图不创建替换文件，而是在同一事务中写入 `generator_version`、`artifact_role`、
  `generator_id`、`settings_hash` 和 `artifact_key`；普通波的 GIF metadata 补偿逻辑排除
  该 durable marker，避免“metadata 缺失”把已保留的动画重新打回队列。
- 复制阶段的 legacy artifact 会暂时沿用外部库元数据中的源媒体尺寸，以保持 copy-first
  首屏；后台实际验证成功后，thumbnail/video_poster 的 `revision_artifacts.width/height`
  更新为副本真实尺寸，或更新为归一化输出尺寸。源媒体尺寸独立保存在
  `extracted_metadata`，不再混入卡片 artifact 几何；物理输出尺寸由 Sharp 头部约束并在
  测试中验证。

## 性能基准

手工基准命令（Electron Node ABI，3 个隔离目标库；每个 64 个外部预览，其中 16 个实际已
有界但对应源媒体仍为高分辨率，48 个为高熵大预览；不是用户库替代）：

```bash
env SERPENT_IMPORTED_THUMBNAIL_BENCH=1 \
  SERPENT_IMPORTED_THUMBNAIL_BENCH_ASSETS=64 \
  SERPENT_IMPORTED_THUMBNAIL_BENCH_ROUNDS=3 \
  SERPENT_IMPORTED_THUMBNAIL_BENCH_GATE=1 \
  SERPENT_IMPORTED_THUMBNAIL_BENCH_RESULT_PATH=/path/to/isolated-temp/serpent-import-thumbnail-bench-result.json \
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/imported-thumbnail-benchmark.test.ts
```

当次结果：3/3 轮均 64/64 成功；导入 P50/P95/Max 为 232.1/285.7/285.7 ms，后台归一化
波次 P50/P95/Max 为 973.5/980.4/980.4 ms（P95 约 15.3 ms/asset）。新增的单 job 指标为
P50/P95/Max 18.9/21.9/24.5 ms。最大采样 RSS 增量 21.7 MiB，跨轮累计 RSS 增量 79.7 MiB；
Worker 导入阶段 event-loop lag 最大 266.4 ms，归一化阶段最大 1.8 ms；交互 visible wave
P95 1.4 ms 且处理 0 个归一化任务。每轮 16 个有界副本原样保留，48 个候选累计从
232,187,286 bytes 降到 4,523,511 bytes，减少 98.05%。门槛按导入 P95 <1,000 ms、归一化
P95/asset <50 ms、单 job P95 <250 ms、归一化 event-loop lag <250 ms、峰值/累计 RSS <256 MiB
判定；导入 event-loop lag 记录为 Worker 复制/哈希路径，不等同于主窗口阻塞。另跑 1 轮 × 8
的可选 32 MP 单页压力档位：8/8 成功，单 job P50/P95/Max 17.5/21.9/21.9 ms，峰值/累计
RSS 增量 6.6/13.4 MiB，导入/归一化 event-loop lag 27.8/1.8 ms；该档位验证了 32 MP 入口
和双栅格内存预留，但不替代多页动画压力。基准包含实际像素验证和输出字节断言，仍不能替代
20k/真实 Eagle 用户库、Windows、NAS/SMB 或 packaged 证据。

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts` 定向运行策略、
  内存预算、归一化、Eagle、Billfish、thumbnail-throughput：6 files / 47 passed。
- `npm run typecheck`：通过；`npm run lint`：通过；`git diff --check`：通过。Lint 仅报告
  `library-service.ts` 超过 Babel 500 KB 优化阈值的提示，不是错误。
- 完整 `npm run test`：484 files passed / 15 skipped，4,208 tests passed / 24 skipped；
  4 个既有环境失败（ffmpeg 当前 bundle 不支持 `lavfi`、macOS `/private` 路径断言、
  packaged `better_sqlite3.node` 只有 7 bytes），不能记作全绿；未出现 D.5 新增失败。
- 本轮校正后 `npm run test:library-availability`：9 files / 207 passed；串行
  `npm run test:worker`：86 files passed / 14 skipped，1,269 tests passed / 22 skipped。
- `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts`：真实 Electron 2 passed / 1 skipped；
  预览图实际解码和视频失败诊断通过。资源导入 E2E 的既有 macOS 菜单选择器不匹配仍为 1 failed，
  不归因于 D.5。
- 真实 Electron 外部库导入 E2E、真实 Eagle/Billfish 大库、NAS/SMB、Windows 和 packaged
  证据仍未执行，不能将合成 Worker 证据写成平台验收通过。

## 2026-08-26 校正审查结论

Luna High 校正审查发现原日志仍描述旧的 `page:0` 静帧策略；实现已统一为：多页 GIF/WebP
直接保留外部 ready artifact，归一化 job 只完成 marker，不生成替换文件。source 和廉价
artifact path 查询进入 `interactive-control`；真正可能触发插件/RAW/OIIO/ICO 解码或写入
viewer artifact 的 preview resolution 保持 `viewer-upgrade`，避免错误占用廉价查询车道。
deadline 的 admission 副作用移动到 scheduler 确认请求仍有效之后。上述行为已补定向测试，
真实动图用户库及跨平台证据仍未执行。

## 2026-08-27 Luna High 阶段复核后的修正

复核进一步指出两类实际风险：仅读容器 metadata 不能证明压缩像素流完整，以及资源耗尽、
lease 丢失或启动恢复不能把归一化 marker 覆盖成普通错误。当前实现已改为每个外部副本都
在后台以 `failOn: 'error'` 逐页解码（最多 128 页），只有成功后才写入 durable marker；
归一化输入按 32 MP 上限进行保守 native 内存预留，不使用外部源图尺寸作为预览准入依据。
归一化输出通过质量/边长阶梯保证 ≤512 边长、≤256 KiB，并且把 artifact 几何写成实际
副本/输出尺寸，源图尺寸继续保存在独立 metadata artifact。截断副本、资源耗尽、lease
丢失和重开恢复均有回归测试；可见波对 marker 任务处理数为 0。

## 2026-08-27 D.5 收口复核后的补强

在上述修正后又补齐了审查指出的边界：逐页解码期间和每次重编码前后都检查取消信号；
marker 写入和替换事务均在事务内校验 asset 的 current revision，并用带 revision 条件的
更新防止旧 job 发布结果；旧文件删除改为提交后的 best-effort 清理，避免清理异常反向删除
已提交的新文件。历史 GIF 修复 SQL 现在排除 Eagle、Billfish 和全部 `import-thumbnail@2`
marker，单帧 GIF 与多帧 GIF 都有防重复调度回归；129 页动画被明确拒绝而保留旧 ready 副本。
归一化的 native admission 以 32 MP × 两份 RGBA 栅格加输入暂存估算，覆盖 Sharp/libvips
与 raw Buffer 同时存活的峰值，而不是只按一份像素图估算。

## 2026-08-27 Luna High 最终复核

最终只读复核确认当前 D.5 无 P0/P1，也没有新的 Standards 问题；逐页动画参数、GIF stale
repair、marker/取消/revision/cleanup 保护和单 job 尾延迟基准均已核对。保留两项 P2 证据限制：
现有“重开恢复”仍是同一测试进程内重新创建 `LibraryService`，没有覆盖 UtilityProcess 在
rename/事务/cleanup 边界被杀后的恢复；合成基准仍不是独立 Worker/UI 并发、真实 Eagle/Billfish
大库、Windows、NAS/SMB 或 packaged 基准。两者均按“未验证”处理，不作为 D.5 完整平台验收依据。

## 未完成与下一步

`Serpent-688714` 的代码路径、失败保护、marker identity、artifact 几何修正和合成基准已完成；
本轮资源库可用性、Worker 回归和媒体预览 Electron E2E（2 passed / 1 skipped）已通过。真实
Eagle/Billfish 大库的存量修复尾延迟、NAS/SMB 读取、Windows/packaged 兼容、进程级 rename/
事务边界崩溃恢复和真实动图矩阵仍未验证（32 MP 压力档位仅覆盖单页）。资源导入 E2E 的首个场景仍在 macOS 等待仅
Windows 提供的“主菜单”按钮（1 failed），不能将该平台不匹配测试写成通过；严格 500 ms
全部可见图片门禁的证据仍以 D.6 的 20k 本地夹具为限，不能关闭 `Serpent-sa65` 或
`Serpent-688714`。
