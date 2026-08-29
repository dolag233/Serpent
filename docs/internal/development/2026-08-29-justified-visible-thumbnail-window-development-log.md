# 2026-08-29 平铺模式视口顶部缩略图丢失开发日志

## 范围

修复 Windows 真机大库平铺（justified）浏览：视口顶部卡片只显示文件图标、
元数据仍在；滚动越深缺失越多。瀑布流无此问题。工单 `Serpent-614293`。

## 红测与根因

用户在约 2.9 万项库中，平铺 20% 位置缺约一行缩略图，90% 位置接近一半。
卡片已挂载（文件名/尺寸可见），但 `AssetCardMedia` 未挂 URL。

虚拟浏览为滚动连续性挂载 overscan 跑道，只有
`loadImmediately === true` 的卡片才会绕过 `deferUntilVisible` 去解码。
平铺用几何 `offset + bodyHeight` 与 `useCanvasLocalViewport` 的真实
`visibleStart/visibleEnd` 比较。瀑布流行程已经：

- 槽位显式 `height: bodyHeight`
- `.masonry-column { gap: 0 }`，间距走 `marginBottom`

平铺只锁了 `--justified-preview-height`，caption 按字体自然撑开，且
`.justified-rows` 仍是 `gap: 14px`。DOM 行高大于几何模型时，误差从
overscan 窗口起点向下累积，视口顶部被算成“跑道外”，于是不挂缩略图。
条目越多、滚得越深，同一视口里被误判的行数越多。

## 实现

- 平铺行显式锁 `height: bodyHeight`、`flex-shrink: 0`、`overflow: hidden`，
  与瀑布流槽位同一合同。
- `.justified-rows { gap: 0 }`，间距只走行 `marginBottom`。
- caption 高度锁到 `--justified-caption-band`，避免字体/DPI 把行撑高。
- `itemIntersectsVisibleRange` 抽成纯函数，覆盖“顶部裁切仍算可见”以及
  “几何 offset 上漂后顶部丢失”的回归。

## 验证

```text
npx vitest run --config vitest.config.ts tests/unit/viewport-window.test.ts tests/unit/virtual-browse-canvas.test.ts tests/unit/justified-slot-style.test.ts
```

3 files / 23 passed。真实 2.9 万项库、Windows packaged 待人类验收。
