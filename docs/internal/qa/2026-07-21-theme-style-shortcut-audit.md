# 主题 / 同屏风格 / 快捷键审计 punch-list

> 工单：`Serpent-4ojz`（2026-07-21 部分收口）→ 后续 `Serpent-vf8x` / `Serpent-b9xo`
> 平台：以 macOS 开发态可见问题为主；**不声称 Windows 已验证**。

## 已在本回合修复

| ID | 问题 | 修复 |
| --- | --- | --- |
| THEME-012 | 警告 toast 仍用蓝色 accent，与错误 toast 琥珀系冲突 | `.toast.is-warning` 与 `.is-error` 共用 warning token |
| THEME-013 | 亮色下对话框/过滤面板阴影过重（暗色 42% 黑） | `--shadow-elevated` / `--shadow-panel` / `--shadow-menu` / `--shadow-toast` |
| THEME-014 | 查看页播放错误条硬编码深棕底 | 改为 `warning-muted` + pane mix |
| THEME-015 | 导入冲突下拉高度/圆角与壳层控件不一致 | `decision-field select` 对齐 `--shell-control-height`（交叠 `Serpent-p1rm`） |

顺带：AI 搜索按下态、搜索高亮 mark、inline-error 边框改走 warning token，去掉散落 RGB。

## 2026-07-21 后续收口（`Serpent-vf8x` / `Serpent-b9xo`）

| ID | 问题 | 修复 |
| --- | --- | --- |
| COMMAND-005 | 文件夹快捷键缺失；Windows Ctrl 体系未文档化 | 侧栏命令 ShortcutSpec + `platform-shortcut-table` 文件夹行；`data-nav-folder-*` 焦点派发；`folder-shortcut-dispatch` |
| THEME-016 | 起始页 / 维度过滤弹出 / AI 模型下拉仍用固定黑晕 | 改走 `--shadow-elevated` / `--shadow-panel` / `--shadow-menu` |

## 仍开放（已有或新开 beads）

| 项 | 说明 | 跟踪 |
| --- | --- | --- |
| Windows 去顶栏菜单 | 代码已平台分支；真机验收 | `Serpent-r7gu` → SHELL-024-windows |
| Windows 原生对话框语言 | Main 硬编码中英混杂 | `Serpent-bwb` |
| Inspector 竖图圆角/标题 | 已有相关单 | `Serpent-hhy0`（若仍开） |
| 色卡文案精简 | 已有相关单 | `Serpent-l79c` |

## 2026-07-21 续（`Serpent-p1rm` / `Serpent-y941`）

| ID | 问题 | 修复 |
| --- | --- | --- |
| THEME-015 | 冲突下拉仍偏原生 | `appearance:none` + 主题 tertiary chevron；focus/hover 与 text-field 同族 |
| SHELL-025 | Inspector 最小宽偏大 | `INSPECTOR_PANEL_WIDTH_MIN` 260→200（与 nav 同地板） |

## 快捷键（共享表）

资产与文件夹命令的 mac ⌘ / Windows Ctrl 对照见
[`src/shared/platform-shortcut-table.ts`](../../../src/shared/platform-shortcut-table.ts)。
文件夹侧栏焦点派发已由 `Serpent-vf8x` 落地；Windows 真机仍待人类验收。
