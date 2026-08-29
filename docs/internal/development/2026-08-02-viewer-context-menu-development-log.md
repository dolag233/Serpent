# 2026-08-02 查看器旋转入口与右键操作菜单

## 范围

收口 `Serpent-ls2p` 的查看器交互：把旋转从顶部浮动按钮移到底部 toolbar；为图片、视频和序列查看页增加右键操作菜单，复用资产菜单的 surface、条目间距、hover 和快捷键排版，并增加轻微透明模糊。

## 实施

- `AssetPreviewModal` 只维护查看会话中的显示变换和菜单坐标；右键事件仅在图片、视频和序列查看页拦截，文本/音频仍保留原有行为。
- `ZoomableImage`、`VideoPlayerControls` 和 `ImageSequencePlayer` 的底部控制条提供顺时针旋转入口；`fitRequestToken` 让菜单中的“适应窗口”调用现有 Fit 状态机，不复制缩放逻辑。图片、视频和序列使用小键盘 `.` 适应窗口；视频保留 `F` 作为下一帧。
- 查看器关闭时不再把浏览画布切换为 `display:none`：查看器宿主改为脱离 flex 的全尺寸绝对定位叠层，避免把滚动容器压成 `height: 0` 后被 Chromium 将 `scrollTop` 夹回顶部。关闭恢复增加代际校验，快速重新打开同一资产时不会由旧的 rAF/API 完成回写焦点或恢复状态。
- 图片查看器的快捷键捕获不再把缩放滑块或色彩空间下拉框误判为文本输入；即使焦点仍在这些控件上，小键盘 `.` 也能执行适应窗口。
- `viewer-fit-shortcut` 单测覆盖 `NumpadDecimal`、Windows `Decimal` 兼容值和普通句点不误触发。
- 新增 `ViewerContextMenu`，使用 `context-menu` / `context-menu-item` 公共 class，菜单外点击、滚动、窗口尺寸变化和 Esc 均关闭；镜像启用态在菜单内保持高亮。
- 查看器右键菜单的操作文案已经足够明确，不再附加重复的 hover tooltip；菜单外同时监听 pointer/mouse down，点击或触控菜单外区域会立即关闭。通用资产、标签、合集右键菜单沿用同样的无 tooltip 规则。
- `viewer-display-transform.ts` 新增纯动作 reducer，统一 toolbar 与菜单对旋转/镜像的状态更新并保持非破坏性。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npx vitest run --config vitest.config.ts tests/unit/video-player-controls.test.ts tests/unit/viewer-video-shortcuts.test.ts tests/unit/viewer-display-transform-actions.test.ts`：3 files / 41 tests passed。
- `git diff --check`：通过。
- Windows 开发态 Electron Computer Use：打开图片查看页确认底部旋转按钮；右键画面确认旋转、水平/垂直镜像、适应和全屏菜单；点击水平镜像后无报错并可用 Esc 关闭查看页。滚动到网格中段后连续快速打开/退出 4 次，关闭后仍停留在原中段视图。

## 未执行与后续

- 本回合未运行完整 Electron E2E；视频快捷键、快速打开/退出的无闪烁体验仍需 Windows 与 macOS 实机人工验收（见 `VIEWER-026`）。
- 旋转/镜像继续只影响查看会话，不写回文件、EXIF、资产修订或数据库。
