# 框选拖拽性能优化开发日志（Serpent-wgl2）

日期：2026-08-12

## 现象

用户反馈：资产浏览面板框选过程中帧率非常低，拖拽选框明显卡顿。

## 根因（代码定位）

`useAssetSelection.ts` 的 marquee 拖拽路径在**每个 pointermove 事件**（高刷屏
~120Hz）同步执行：

1. `handleMouseMove` → `updateMarquee` → `collectHits`：
   - `canvas.querySelectorAll('[data-asset-id], [data-folder-id]')` 遍历全部卡片；
   - **每张卡片 `getBoundingClientRect()`** —— 每帧 N 次强制 layout/reflow；
   - 1000 张资产 = 每帧 1000 次 reflow。
2. `setMarqueeBox` + `setSelectedAssetIds(nextSelection)` **每帧** —— 选中集合
   的 React setState 触发网格重渲染（选中态类更新），即使命中集合未变化。

## 修复（三处）

1. **rAF 节流**：pointermove 只把指针坐标存入 ref；`requestAnimationFrame`
   每帧执行一次 `updateMarquee`（120Hz → 60fps）。
2. **卡片 rect 内容坐标缓存**：首次读 DOM 后把 rect 转换到 canvas-content
   坐标缓存（滚动不影响内容坐标）；仅当 canvas 布局尺寸变化（resize/列数
   重排）时清缓存。滚动/自动滚动时只付一次 viewport 读取，不再付 N 次 reflow。
3. **命中集合 diff**：`applyMarqueeHits` 只在命中集合实际变化时
   `setSelectedAssetIds` —— 大多数帧只是选框移动、未跨越卡片边界，不再
   触发网格重渲染。

自动滚动路径（autoScrollLoop 每帧滚动后 updateMarquee）保持每帧更新，
保证命中跟随滚动内容。

## 验证

- typecheck / lint 通过；
- marquee 相关单测 23/23 通过（marquee-selection / marquee-geometry /
  selection-anchor）；
- 新增缓存等价性测试：缓存命中路径与直接 DOM 读取产生**完全相同的命中集合**
  （500 卡片 × 5 帧）。
- 受控性能基准：真实 DOM 环境不可用（worker 测试为 Node 环境无布局引擎），
  性能收益以机制分析 + 用户实测为准：免去每帧 N 次强制 reflow 与每帧网格
  重渲染，是高刷屏上卡顿的直接来源。
- **Windows 真机 / packaged 未验证**（无 runner）——显式未验证项。

## 后续

若用户实测仍有卡顿：下一步测平铺 vs 瀑布流的 hit 扫描成本、100/500/1000
资产分级基准、自动滚动期间帧率。
