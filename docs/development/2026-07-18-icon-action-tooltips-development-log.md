# 2026-07-18 REQ-SHELL-013 纯图标控件 tooltip

## 背景

用户反馈侧栏「添加文件夹 / 导入链接文件夹」等纯图标按钮无悬停说明，看不懂含义（`REQ-SHELL-013` / beads `Serpent-d3c`）。

## 根因

部分控件已有 `aria-label`（无障碍可读），但缺少可见悬停提示。仅补原生 `title` 在 Electron 下不可靠：工具栏 `-webkit-app-region: drag` 会吞掉悬停，且 Chromium 原生 title 延迟很长。

## 实现

- `iconActionAttrs(label)`：同时设置 `aria-label`、`data-tooltip`、`title`。
- `IconActionButton`：壳层常用纯图标按钮封装。
- CSS `[data-tooltip]::after`：悬停立即显示提示气泡。
- 扩大工具栏 `no-drag` 覆盖（button/input/label/面包屑等）。
- 侧栏文件夹区显式使用 `nav.addFolder` / `nav.importLinkedFolder`。

## 验证

- `npx vitest run tests/unit/icon-action-attrs.test.ts`：通过。
- `tests/e2e/shell-navigation.test.ts`：断言侧栏按钮 `title` 与 `data-tooltip`。

## 人类验收

清单条目：`SHELL-013`（待人类验收）。
