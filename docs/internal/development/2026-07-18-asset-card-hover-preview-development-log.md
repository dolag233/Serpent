# 2026-07-18 网格卡片动图/视频悬停预览（Serpent-05o / REQ-CANVAS-009）

## 范围

悬停或主选中时，GIF / 视频在网格卡片内原地播放；离开且未选中时恢复静态封面。静图仅封面。同一时刻最多一个活动预览（悬停优先于选中）。

## 实现

- `src/renderer/asset-card-hover-preview.ts`：纯函数（`isCardHoverPreviewable` / `resolveActivePreviewAssetId` / `coverSrc`）
- `src/renderer/use-asset-card-hover-preview.ts`：约 200ms 防抖、`requestPreview(mode: client)`、结果缓存与清理
- `src/renderer/AssetCardMedia.tsx`：封面 + 活动 GIF `<img>` 或静音循环 `<video poster>`
- `App.tsx`：在 `.asset-preview` 内接入（justified / masonry 共用同一卡片子树）
- `styles.css`：`.asset-card-media` 绝对铺满、`object-fit: cover`、`pointer-events: none`
- 单元测试：`tests/unit/asset-card-hover-preview.test.ts`

## 验收

- CANVAS-014（勿与已占用的 CANVAS-009 瀑布流条目混淆）

## 未执行

- Computer Use；真实 Electron 媒体解码旅程移交人工验收
