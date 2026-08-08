# 2026-07-18 REQ-SHELL-013 纯图标控件 tooltip

## 背景

用户反馈侧栏「添加文件夹 / 导入链接文件夹」等纯图标按钮无悬停说明，看不懂含义（`REQ-SHELL-013` / beads `Serpent-d3c`）。

## 根因

部分控件已有 `aria-label`，但缺少可见悬停提示。原生 `title` 在 Electron 拖拽区下不可靠。

## 实现

- `iconActionAttrs` → `aria-label` + `data-hover-tip`
- `HoverTipHost`：document 委托，约 420ms 延迟后以 portal 挂到 `document.body`（`z-index: 41`，与右键菜单同层）
- 样式克制：小字号、次要色、轻边框，无强阴影
- 工具栏 `ToolButton`、侧栏 tiny-action、前进后退、缩略图滑块等接入

## 人类验收

清单条目：`SHELL-013`。
