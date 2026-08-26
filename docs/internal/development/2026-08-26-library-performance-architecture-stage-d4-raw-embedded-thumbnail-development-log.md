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
| 有界扫描 TIFF/IFD 并精确读取内嵌 JPEG | `src/worker/raw-embedded-thumbnail.ts` | `tests/unit/raw-embedded-thumbnail.test.ts`：小端、大端、前缀、非法范围、非 JPEG 与 8 MiB 上限 | macOS 开发态单测 3/3；真实相机样本矩阵未配置，未宣称 NEF/CR3/RAF 等格式完整支持 |
| RAW 卡片优先生成 JPEG artifact，保留 revision/generator 身份 | `src/worker/library-service.ts` `tryGenerateRawEmbeddedThumbnail` | `tests/worker/video-exr.test.ts`：crafted ARW 导入、artifact 解码、尺寸/生成器断言 | Electron Worker 定向 56/56；生成器包含 `raw-embedded-jpeg@1`，实际 artifact 为可解码 JPEG |
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

## 验证记录

- `npx vitest run --config vitest.config.ts tests/unit/raw-embedded-thumbnail.test.ts`：
  1 file / 3 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts`：
  1 file / 56 passed。
- `npm run test:library-availability`：9 files / 203 tests passed。
- `npm run typecheck`：通过。
- 定向 ESLint（helper、`library-service.ts`、Worker/单测）：通过；保留既有大文件 Babel
  deopt 提示，不是 lint failure。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/real-raw-format-matrix.test.ts`：
  真实 RAW 环境变量未配置，矩阵未执行，不能把 fixture 结果写成相机格式覆盖。
- `node scripts/run-e2e.mjs tests/e2e/raw-image-preview.test.ts`：真实 RAW 测试文件未配置，
  RAW 查看器 E2E 未执行；普通媒体/序列查看器回归由 D.3 记录。

## 未完成与下一步

D.4 的快速卡片路径和安全 fallback 已实现，但真实 RAW 格式覆盖仍需样本矩阵（至少 ARW、
NEF、CR2/CR3、RAF、ORF、RW2、DNG、PEF）以及 Windows/packaged 证据。`Serpent-7028e9`
保持 open，`Serpent-235f69` 也不能因这一条路径关闭。

性能架构的下一个媒体模块是外部库导入缩略图归一化：Eagle/Billfish 现存的大尺寸缩略图
会把无必要的像素和字节带入可见窗口，应按 `Serpent-688714` 的 512 fit-inside 策略做
可取消、崩溃安全的后台修复，并补充新导入与存量库的真实解码尾延迟基准。
