# 2026-07-18 视频 extracted_metadata Inspector 展示

工单：`Serpent-sdc`（REQ-VIEW-003）

## 范围

查看页与 Inspector 展示视频帧率、码率、编码与音轨信息。本增量交付 **Inspector 紧凑信息行**；查看页 chrome 未扩展（非阻断，后续可复用同一 API 与 `formatVideoTechnicalLine`）。

## 方案

1. **不膨胀 AssetSummary**：列表/搜索仍只有 `width` / `height` / `durationMs`。
2. **正式化 schema**：`extractedVideoMetadataSchema` / `extractedMetadataResultSchema`（`src/shared/asset-types.ts`），对齐 worker `probeVideoAsset` 已写入的 JSON；可选 `containerBitrate` / `frameRateFps`。
3. **新 get API**：`asset.extracted-metadata.get`（renderer request → main → worker command → response `asset.extracted-metadata.got`）。
4. **Worker**：`LibraryService.getExtractedMetadata` 读当前修订的 `extracted_metadata` artifact；`ready` 解析 JSON；`pending` / `missing` / `failed` / 损坏 JSON 返回安全 status + `metadata: null`。
5. **Probe 增量**：写入时附带 `containerBitrate`（format.bit_rate），旧 artifact 仍可读。
6. **Inspector**：单选视频时经 `api.getExtractedMetadata` 拉取；pending/missing 有限轮询；紧凑行追加 `formatVideoTechnicalLine` 结果。

## 实现位置

| 层 | 路径 |
| --- | --- |
| Schema | `src/shared/asset-types.ts` |
| Protocol | `src/shared/protocol/requests.ts` / `responses.ts` |
| API | `src/shared/library-api.ts` / `src/preload/index.ts` / `src/main/index.ts` / `src/worker/index.ts` |
| Worker | `src/worker/library-service.ts`（`getExtractedMetadata` + probe `containerBitrate`） |
| UI | `src/renderer/InspectorPanel.tsx` + `src/renderer/video-metadata-format.ts` |
| App 接线 | `src/renderer/App.tsx`（传入 `api`） |

## 证据（实现当时）

- `npm run typecheck` 通过
- 单测：`npx vitest run tests/unit/video-metadata-format.test.ts` → 9 passed（格式 + schema/协议）
- Worker：`npm run test:worker -- tests/worker/video-exr.test.ts -t "extracted_metadata|missing extracted"` → 2 passed
- 相关文件 eslint 通过（InspectorPanel）
- 人类验收：`VIEW-007` 进入待人类验收
- Computer Use：未执行

## 未做 / 边界

- 查看页底部 chrome 未展示同一行（可选，未做）
- Windows / packaged 未验证
- Computer Use 未执行
- 不关闭工单直至用户验收与合流门禁由主 agent 收口
