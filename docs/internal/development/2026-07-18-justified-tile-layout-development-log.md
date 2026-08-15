# 2026-07-18 平铺 justified 行布局（Serpent-8nj）

## 范围

平铺模式改为等行高、保比例、整行填满的 justified 布局；卡片下方显示像素尺寸。参考 `docs/internal/前端参考/2026-07-18-tile-layout-reference.png`。

## 实现

- `layoutJustifiedRows` / `aspectRatioForAsset`（`asset-grid-layout.ts`）
- `JustifiedAssetRows` 渲染器（ResizeObserver + 行槽位宽度）
- 平铺模式始终显示 `宽 × 高`；孤张末行不强制拉满全宽
- 瀑布流仍走 `MasonryColumns`，未改语义

## 测试

- `tests/unit/asset-grid-layout.test.ts` — 行填满、分行、孤张不拉伸

## 验收

人类清单 **CANVAS-010**（并关联复验 **CANVAS-007**）。
