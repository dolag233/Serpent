# 查看页被 workspace-canvas-host 挤占半屏 — 开发记录

- 日期：2026-07-21
- 分支：`codex/windows-adaptation`
- 相关验收：`VIEWER-019`
- 相关改动：`Serpent-yl67`（`workspace-canvas-host`）

## 现象

Windows 上打开资产查看页（Fit / 适应）：

- 图片落在舞台下半区，上半区大块空白，顶部被裁切感
- 关闭按钮落在整窗垂直中线附近（本应在查看区右上角）

macOS 上同一查看体验此前表现为正常。

## 误诊（已回滚）

曾误判为：Windows Electron 上替换元素（`<img>` / `<video>`）的 CSS 百分比 `translate(-50%)` 未与 inline `transform` 正确合成，导致媒体顶边钉在视口中心。

据此做过无效修改（均已还原）：

- `viewerMediaTransform` 像素半宽/半高居中
- 去掉 `.preview-image` / `.preview-video` 的 `translate: -50% -50%`
- `transform-origin: 0 0`

这些改动无法解释「关闭按钮也被挤到中间」——关闭钮是相对 `.preview-content` 的 `top: 10px`，与媒体 transform 无关。

## 根因

`Serpent-yl67` 为让导出/导入进度条不随画布滚动，引入 `.workspace-canvas-host`（`flex: 1`），activity-strip 挂在 host 上、canvas 仍在 host 内。

查看时只给 `.workspace-canvas` 加了 `is-viewing` → `display: none`，**host 本身仍 `flex: 1`**。  
同列的 `.workspace-viewer` 也是 `flex: 1`，二者对半分高：

| 区域 | 结果 |
|------|------|
| 上半 | 空的 canvas-host（canvas 已隐藏） |
| 下半 | 查看器；关闭钮在「查看器顶部」= 整窗中线 |

这是纯布局回归，与字体、平台 translate 无关。

## 为何 macOS 当时正常

macOS 上看到的正常效果对应 **host 引入之前** 的布局：viewer 独自 `flex: 1` 占满中间列。

`workspace-canvas-host` 与本次回归同日（2026-07-21）落地。同一份「有 host、查看时不藏 host」的代码，macOS 同样会坏；并非 Windows 专属渲染差异。先前「Mac 正常 / Win 百分比 translate 失效」的说法是误诊带来的错误解释。

## 修复

- `App.tsx`：查看时给 `workspace-canvas-host` 同步 `is-viewing`
- `styles.css`：`.workspace-canvas-host.is-viewing { display: none; }`
- 保留原有 CSS `left/top: 50%` + `translate: -50% -50%` + pan 的 inline `transform`
- E2E（`media-preview`）：断言查看时 host 隐藏，且 Fit 图相对 viewport 居中；顺带将易冲突的 `getByLabel("名称")` 改为 `getByRole("textbox", { name: "名称" })`

## 验证

- 人类：Windows 完全重启后打开横/竖图 → 关闭钮右上、Fit 居中（`VIEWER-019`）
- 自动化：`tests/e2e/media-preview.test.ts` 上述断言（完整 E2E 需在后台按门禁跑）

## 教训

1. 关闭钮位置是布局问题的强信号；不要先改媒体 transform。
2. 子节点 `display: none` 不会取消父级 `flex: 1` 占位；查看态要把整条 chrome/host 一并收起。
3. 相对 viewport 的居中断言在「viewport 本身只占半屏」时仍会绿——应用断言覆盖「host 已隐藏 / viewer 占满工作区」。

## 2026-07-22 二次回归

`8556caa`（WorkspaceNoticeBanner / SHELL-027）为让查看态仍显示 notice，把选择器从
`.workspace-canvas-host.is-viewing` 改成 `.workspace-canvas-host.is-viewing > .workspace-canvas`，
半屏空白立刻回来。

兼顾方案（同日）：

- host 查看态折叠为 `flex:0; height:0; overflow:visible`（不占 flex 行），而不是 `display:none`
- `z-index: 25` + `pointer-events` 分流，让绝对定位的 notice/strip 叠在 viewer 之上
- canvas 子节点仍 `display: none`
- E2E 继续断言 host `toBeHidden`（零尺寸 bounding box）
