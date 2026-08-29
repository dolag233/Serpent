# 2026-08-26 大型资源库性能架构阶段 D.4 开发日志：RAW 内嵌预览缩略图

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  
关联工单：`Serpent-7028e9`、`Serpent-235f69`

## 目标

RAW 文件通常已经携带相机生成的低分辨率 JPEG 预览。资源库卡片只需要快速、可丢弃的
预览，不应在每次导入或进入可见窗口时启动完整 RAW demosaic。D.4 将卡片预览与查看器
高清解码分离：能安全复用内嵌 JPEG 时只读取必要的 TIFF/IFD 结构和 JPEG 范围；格式不
明确、结构损坏或资源预算不足时继续使用原有 OIIO fallback。低清内嵌图绝不替代查看器
的完整 RAW 内容。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 有界扫描 TIFF/IFD 并精确读取内嵌 JPEG | `src/worker/raw-embedded-thumbnail.ts` | `tests/unit/raw-embedded-thumbnail.test.ts`：小端、大端、前缀、非法范围、非 JPEG、8 MiB 上限，以及元数据空结果/失败/取消；5/5 | macOS 开发态单测 5/5；真实相机样本矩阵未配置，未宣称 NEF/CR3/RAF 等格式完整支持 |
| RAW 卡片优先生成 JPEG artifact，保留 revision/generator 身份 | `src/worker/library-service.ts` `tryGenerateRawEmbeddedThumbnail` | `tests/worker/video-exr.test.ts`：crafted ARW 导入、artifact 解码、尺寸/生成器断言；队列路径另证明确实先完成卡片再运行元数据任务 | 当前定向组合回归 4 files / 144 tests passed；生成器包含 `raw-embedded-jpeg@1`，实际 artifact 为可解码 JPEG |
| 超出读取/像素预算或解析失败回退 OIIO | `raw-embedded-thumbnail.ts`、`library-service.ts` | `tests/unit/raw-embedded-thumbnail.test.ts`；`tests/worker/video-exr.test.ts` 断言成功路径不调用 OIIO | 安全边界由自动化证明；真实大 RAW、超大内嵌预览和 OIIO fallback 的跨平台耗时未验证 |
| RAW 卡片不做无效的 OIIO `--info` 色彩空间探测；查看器仍走完整 RAW 路径 | `src/worker/library-service.ts` `generateThumbnail`/`generateOiiOThumbnail` | `tests/worker/video-exr.test.ts` 过滤并断言没有 OIIO invocation；既有查看器/媒体测试保持通过 | macOS 开发态 Worker 通过；真实查看器 RAW 高清体验、packaged、Windows、Computer Use 未执行 |

## 关键边界

- 头部扫描最多 64 KiB，IFD 链最多 8 层，单个 IFD 最多 4096 项；不会把整个 RAW 文件
  读进内存。
- 内嵌 JPEG 最大读取 8 MiB，Sharp 解码像素预算为 16 MP；JPEG 头、范围和尺寸不满足
  条件时返回 `null`，由 OIIO 路径决定是否可以继续生成。
- 内嵌 JPEG 只用于 `card-thumbnail`；RAW 查看器仍保留完整尺寸、完整颜色/元数据语义，
  不能把卡片缩略图误当成原始内容。
- RAW 默认使用 sRGB，卡片路径跳过不产生业务收益的 OIIO `--info` 探测，避免已确定的
  快速路径仍启动一个原生进程。

## D.4 后续收口：卡片与 RAW 技术元数据解耦

前一版实现虽然避免了 RAW demosaic，但 `tryGenerateRawEmbeddedThumbnail` 在发布卡片
artifact 前仍同步等待 `exifr` 的 TIFF/EXIF/IPTC/XMP 解析；真实相机文件的元数据块可能很大，
这会把 Inspector 的低优先级工作重新放回首屏路径。本轮将这个耦合拆开：

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 队列 RAW 卡片不等待技术元数据解析 | `MediaExecutionContext.includeRawMetadata=false`；`tryGenerateRawEmbeddedThumbnail` / `generateOiiOThumbnail` | `tests/worker/video-exr.test.ts` 的“keeps queued RAW card generation independent from EXIF metadata extraction”：注入阻塞 parser，先运行 primary，再释放 metadata job | macOS Electron Worker 定向测试通过；真实相机大 EXIF 块耗时、packaged、Windows、NAS/SMB、Computer Use 未执行 |
| RAW 技术元数据使用独立有界二级 job | `enqueueRawImageMetadataJobs`、`generateQueuedRawImageMetadata`；`extract_metadata` 复用 technical-metadata role | `tests/unit/artifact-policy.test.ts` 验证 image metadata role/kind；Worker 用例验证 metadata job ready、卡片已先 ready | 当前只证明 crafted ARW 的时序隔离；真实 NEF/CR3/RAF/ORF/RW2/DNG/PEF 样本矩阵仍未配置 |
| header-only 尺寸不阻塞后续元数据补齐，metadata-less 文件不会无限重排 | `image-header@*` 非终态识别、成功 job 终态去重、revision/claim admission | `tests/worker/video-exr.test.ts` 覆盖当前 revision 的独立队列；旧库 header artifact 的跨平台/真实迁移样本仍待补充 | 本轮自动化未宣称真实旧库迁移或跨平台证据 |

实现约束：队列 primary 调用明确关闭 `includeRawMetadata`，直接调用 `generateThumbnail` 的兼容
行为仍保留元数据提取；背景入队每次最多 256 个 RAW metadata job，固定低于 primary 优先级，
由 secondary pump 渐进处理。若 parser 没有得到任何受控字段，job 以成功终态结束并持久化
规范化的空 metadata artifact，避免每次刷新重排；已有 `image-header@*` 尺寸仍可用于布局。
若 revision 变化，claim-time fence 会取消旧任务，不能把旧 RAW 元数据写进新 revision。取消只
释放队列等待，不宣称能中断 exifr 内部已经开始的同步解析。

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/artifact-policy.test.ts tests/unit/raw-embedded-thumbnail.test.ts tests/worker/video-exr.test.ts tests/worker/thumbnails.test.ts --reporter=dot`：4 files / 144 tests passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/raw-embedded-thumbnail.test.ts --reporter=dot`：1 file / 5 tests passed。
- `npm run test:library-availability`：9 files / 207 tests passed；`npm run test:worker`：86 files / 1,257 passed / 22 skipped。
- `npm run typecheck && npm run lint && git diff --check`：通过；lint 仅保留 `library-service.ts` 超过 500KB 的 Babel deopt 提示，不是 lint failure。
- `npm run test`：484 passed / 15 skipped；4 个失败均为既有环境门禁（macOS `/private` 路径规范化 2 项、随附 FFmpeg 不支持 `lavfi` 的合成视频 1 项、复制 packaged bundle 时 `better_sqlite3.node` 为 7 bytes 1 项），不是本轮断言回归，故不能记作全绿。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/real-raw-format-matrix.test.ts`：
  真实 RAW 环境变量未配置，矩阵未执行，不能把 fixture 结果写成相机格式覆盖。
- `node scripts/run-e2e.mjs tests/e2e/raw-image-preview.test.ts`：1 skipped（未配置真实 RAW 文件）；
  `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts`：2 passed / 1 skipped。
- `SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH=/private/tmp/serpent-d4-benchmark-final/all-images.json SERPENT_LARGE_LIBRARY_E2E_CLONE_ROOT=/private/tmp/serpent-d4-benchmark-final npm run test:e2e:large-library-benchmark -- /Users/dolag/Development/perf-fixtures/library-20k`：真实 Electron、本地 APFS 隔离 clone、fixture v3、live 19,965、10 次随机跳转，`all-images` 严格指标 10/10；全部图片完成 p50 159.7ms、p95/max 228.1/228.1ms，首波视觉内容 p50 159.1ms、p95/max 199.6/199.6ms，最终完成 10/10。该次 clone 运行与 D.6 的冷 artifact 清理跑不具备完全可比性，作为补充证据，不替代跨次稳定性结论。

Luna High 双轴审查提出的 P1/P2 已落实：Inspector 会把 `header-only` 视为可继续补齐的中间态；
背景入队和 secondary pump 会继续覆盖首批以外的 RAW；解析失败保留 queued/failed 状态并按 30 秒
退避、最多三次重试；取消在队列层立即释放等待者；metadata lane 以有界低优先级和四轮一次的
fairness 规则避免被 palette/proxy 长期遮蔽。该审查没有提供真实相机/packaged/Windows 证据，
本日志不将这些环境标记为通过。

## 未完成与下一步

D.4 的快速卡片路径、技术元数据二级化和安全 fallback 已实现，但真实 RAW 格式覆盖仍需样本
矩阵（至少 ARW、NEF、CR2/CR3、RAF、ORF、RW2、DNG、PEF）以及 Windows/packaged 证据。
`Serpent-7028e9` 保持 open，`Serpent-235f69` 也不能因这一条路径关闭。

D.5 外部库导入缩略图归一化的代码路径已存在，但真实 Eagle/Billfish 样本、存量库尾延迟和
跨平台证据仍未收口；后续应补证据或修复实测瓶颈，不得因为代码存在就把 `Serpent-688714`
标记完成。
