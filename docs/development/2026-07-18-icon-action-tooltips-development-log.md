# 2026-07-18 REQ-SHELL-013 纯图标控件 tooltip

## 背景

用户反馈侧栏「添加文件夹 / 导入链接文件夹」等纯图标按钮无悬停说明，看不懂含义（`REQ-SHELL-013` / beads `Serpent-d3c`）。

## 根因

部分控件已有 `aria-label`（无障碍可读），但缺少原生 `title`，因此鼠标悬停不出现系统 tooltip。`ToolButton` 此前已同时设置两者；`NavigationSidebar` 的 `Section` tiny-action、面板边缘 `pane-reveal`、部分对话框关闭按钮等未对齐。

## 实现

- 新增 `iconActionAttrs(label)`：同一字符串同时作为 `aria-label` 与 `title`。
- 新增 `IconActionButton`：壳层常用纯图标按钮封装。
- 侧栏文件夹区显式使用 `nav.addFolder` / `nav.importLinkedFolder`。
- 补齐：pane-reveal、toast 关闭、Inspector 加标签/喜欢/移除标签、对话框 `dialog-close`、查看页缩放与翻页、过滤 chip 移除等。

## 验证

- `npx vitest run tests/unit/icon-action-attrs.test.ts`：通过。
- `npx tsc --noEmit`：通过。
- `tests/e2e/shell-navigation.test.ts`：已增加侧栏加号/链接图标 `title` 断言；本机当次执行因 Electron 43 拒绝 Playwright 注入的 `--remote-debugging-port=0` 未能启动（环境问题，非本需求回归）。记为未在本机跑通。

## 人类验收

清单条目：`SHELL-013`（待人类验收）。Computer Use 本环境未执行。
