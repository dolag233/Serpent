# 2026-07-18 GIF 缩略图黑帧修复（Serpent-1wg）

## 根因

多页 GIF 的网格缩略图固定取 sharp page 0。CU 样本片头为黑场，固化为近纯黑 WebP；查看页播 `serpent://source` 原 GIF，中段有色，表现为「网格黑、查看有色」。

## 实现

- `src/worker/gif-thumbnail-page.ts`：均匀采样页、亮度×非黑占比打分、选最优页
- `generateImageThumbnail`：`pages > 1` 的 GIF 先探针再出图
- `generator_version` → `sharp@…-gifstill1`；`enqueueThumbnailJobs` 使旧 GIF 缩略图失效并重排队

## 验收

- THUMB-003：含片头黑场的 GIF 重开资源库或触发缩略图队列后，网格卡片非纯黑

## 测试

- `tests/unit/gif-thumbnail-page.test.ts`
- `tests/worker/thumbnails.test.ts`（ffmpeg 可用时）
