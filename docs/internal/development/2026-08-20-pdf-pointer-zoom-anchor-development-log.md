# PDF 后续页指针缩放锚点

日期：2026-08-20
工单：`Serpent-2287bf`
验收：`VIEWER-031`

## 问题

PDF 查看器用 Ctrl+滚轮缩放时，第一页看起来是以鼠标为中心；滚到第 2 页及之后，指针下的内容会大幅偏离。

## 根因

页列是纵向 flex：页面 CSS 尺寸随 `zoom` 变，但 `.pdf-viewer-pages` 的 `padding` 和 `gap` 是常数。旧实现用

`(scroll + pointer) * (nextZoom / zoom) - pointer`

这只在「整段滚动内容从原点均匀缩放」时成立。第一页上方几乎没有未缩放的间距，误差小；后续页上方累加了多段 gap，误差随页码和缩放比放大。

叠加第二项：为避免旧 canvas 被拉伸发虚，缩放时视口外的页盒保持旧高度。滚动却按「全部页已按新 zoom 长高」来恢复，后面的页会再偏一截。

## 修复

- 命中当前指针所在页，记录页内分数坐标 `(fracX, fracY)`。
- 缩放时先把**所有**现有页盒改到新 zoom，再按该页内点恢复 `scrollLeft` / `scrollTop`。
- 优先重栅格化指针所在页，再换上清晰 canvas（仍避免空白 canvas 白屏）。

页盒立即改尺寸时，可见页的旧位图可能短暂被 CSS 拉伸；清晰度仍以新 canvas 替换后为准（`VIEWER-030`）。

## 四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 后续页 Ctrl+滚轮仍以指针为中心 | `pdf-viewer-layout.ts` 页列几何；`PdfViewerSurface.tsx` 缩放恢复 | `tests/unit/pdf-viewer-layout.test.ts`：第 6 页 zoom 1→2 时原点均匀公式偏差 > 50px，页内锚点保持指针下的内容点 | 定向单测已跑；真实多页 PDF、Windows、packaged、Computer Use 未执行 |

## 验证记录

```text
npx vitest run --config vitest.config.ts tests/unit/pdf-viewer-layout.test.ts
# 1 file / 7 passed

npx eslint src/renderer/pdf-viewer-layout.ts src/renderer/PdfViewerSurface.tsx tests/unit/pdf-viewer-layout.test.ts
# 0 errors
```

未改资源库协议，未跑 `test:library-availability`。Electron E2E / Windows / packaged / Computer Use 未执行。
