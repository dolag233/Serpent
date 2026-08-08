# 2026-07-18 查看页浏览附属层 + 适配/缩放控件

工单：`Serpent-ts2`（REQ-VIEW-004）、`Serpent-3w8`（REQ-VIEW-006）

## 根因

1. **叠层挡菜单**：`.workspace-viewer` 使用 `position: absolute; z-index: 12`，而 `.workspace` 未建立 stacking isolation，查看层 z-index 参与根上下文并压过 `.app-toolbar`（z-index 5），资源库菜单被挡住。
2. **切范围不退出**：`chooseFolder` / `enterTrash` / 合集与标签切换未调用 `closeAssetPreview`。
3. **Fit 错误**：`ZoomableImage` 把 `scale: 1` 当作“适应窗口”，实际依赖 CSS `max-width/max-height: 100%`，与真实像素缩放混淆，表现为短边/横向撑满而非最长边 contain。

## 方案

- 查看页仍挂在 `.workspace` 下（画布兄弟节点），作为 flex 子区域替换画布可视区；画布 `is-viewing` 时 `display: none`（保持挂载以恢复滚动）。
- `.workspace { isolation: isolate; z-index: 0 }`，`.app-toolbar { z-index: 30 }`，查看层不再参与压过壳层。
- 范围切换与搜索重置、后退/前进：先退出查看页。
- `fitContainScale` 按 viewport contain 计算初始缩放；底部改为百分比 + range 滑块 + Fit/适应；去掉顶栏；左右边缘上一/下一（顺序仍为 `visibleAssets`）。

## 证据（实现当时）

- 单测：`tests/unit/viewer-fit.test.ts`（4 passed）
- `npm run typecheck` 通过；相关文件 eslint 通过
- 人类验收：`VIEWER-001`（更新）、`VIEWER-002`（重定义）、`VIEWER-004`、`VIEWER-005`
- Electron E2E `media-preview`：本环境 `electron.launch` 失败（`Process failed to launch` / `kill EPERM`），记为未执行，需在可启动 Electron 的环境重跑

## 后续打磨（同日用户反馈）

- 左右导航改为 `chevron-left` / `chevron-right`（`<>` 形）
- 控件约 2s 无指针活动后渐隐（`useViewerChromeIdle` / `viewer-chrome-idle`）
- 新增 `--viewer-stage`：亮色跟 canvas，暗色为柔和深灰，不再强制 `--ink` 纯黑
- 控件改用主题 raised/divider/text，提高亮色可读性
- 人类验收：`VIEWER-006`

### 续（拖拽 / 手势 / 回正 / 图标）

- 切换资产、空格、`F`：回正 Fit
- Fit 根因：无效测量时不再回落到 scale=1（实际像素裁切）；改为 `width/height = natural×scale` 布局，不再用 transform scale
- 平移 `clampViewerPan` 锁边
- 触控板两指滚动平移，捏合缩放；Fit 态水平轻扫切资产（三指依赖系统「页面间轻扫」）；`BrowserWindow` `swipe` 事件
- 查看时隐藏 `.workspace-bar`
- Fit / 全屏改为图标；`<>` 加大
- 人类验收：`VIEWER-007`

## 人类验收（2026-07-18）

用户确认本批查看页验收项全部通过：`VIEWER-001`、`VIEWER-002`、`VIEWER-004`、`VIEWER-005`、`VIEWER-006`、`VIEWER-007`（`VIEWER-003` 此前已通过）。

功能基线：`34442b0`（`feat(viewer): 浏览附属查看页、Fit/手势与控件打磨`）。

工单：`Serpent-ts2`（REQ-VIEW-004）、`Serpent-3w8`（REQ-VIEW-006）于验收通过后关闭。

## 未执行

- Computer Use / 真实桌面截图验收（人类桌面验收已覆盖主要路径）
- Windows
- `tests/e2e/media-preview.test.ts`（此前环境 electron.launch 失败，未作为关闭条件）
