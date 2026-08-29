# 2026-08-29 平铺选中描边与视频卡片尺寸

工单：`Serpent-ebff32`、`Serpent-9c9f97`  
验收：`CANVAS-042`、`CANVAS-043`

## 背景

用户删掉 0.1.5 Release，报告两条阻断：

1. 平铺选中描边完全不对：左侧一条不跟圆角的粗蓝竖条。
2. 导入视频后卡片长宽比不更新、caption 没有分辨率，只有刷新资源库才出现。

## 根因

### 选中描边（`Serpent-ebff32`）

`CANVAS-041` / `Serpent-614293` 给平铺行加了 `overflow: hidden`，用来锁行高，避免 caption 把 DOM 行撑高后 `loadImmediately` 几何漂移。

选中环是卡片向外的 `box-shadow: 0 0 0 2px`（REQ-SELECT-003）。矩形行把圆角外的环裁掉后，间隙里只剩一条贴左边的直蓝条。

行高已经由 inline `height` + `flexShrink: 0` 锁定；caption 自己也有 `--justified-caption-band` 和 `overflow: hidden`。行上再 clip 是多余的，且破坏描边。

### 视频尺寸（`Serpent-9c9f97`）

- 视频宽高来自 ffprobe → `extracted_metadata`。
- `generateVideoPoster` 写入 `video_poster` 时不带 `width`/`height`。
- `asset.thumbnail.ready` 因此没有源分辨率。
- `asset.derived.ready`（`extract_metadata`）在 `App.tsx` 里故意只刷新当前选中 Inspector，避免 canvas render storm。
- 平铺/瀑布流几何读的是 browse-session 快照，不是 live `AssetSummary`。刷新资源库才会重新拉带宽高的 layout。

缺尺寸时 `aspectRatioForAsset` 退回 `1`，卡片接近方框并 letterbox。

## 修复

1. `virtualJustifiedRowStyle` 改为 `overflow: visible`；`.justified-row` 同样声明。高度锁保留。
2. `extract_metadata` 完成后 `onDerivedReady` 带上 `width`/`height`/`durationMs`；Worker 再发 `asset.dimensions.ready`。
3. Renderer 把这些补丁打进 `assets`，并 overlay 到 dense browseLayout / virtual `geometryEntries`（bump `geometryRevision` 以便滚动锚点补偿）。

## 测试

```text
npx vitest run tests/unit/virtual-browse-canvas.test.ts tests/unit/canvas-asset-layout.test.ts tests/unit/virtual-browse-session.test.ts tests/unit/asset-thumbnail-patches.test.ts
# 4 files / 20 passed

node scripts/run-vitest-with-electron.mjs tests/worker/video-exr.test.ts -t "publishes source dimensions|generates extracted_metadata artifact"
# 1 file / 2 passed（64 skipped）
```

未跑：`test:library-availability`（未改 schema/开库路径）、Electron E2E、packaged、Computer Use。2026-08-29 用户真机验收通过（CANVAS-042 / CANVAS-043）。
