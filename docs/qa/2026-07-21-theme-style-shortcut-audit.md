# 主题 / 同屏风格 / 快捷键审计 punch-list

> 工单：`Serpent-4ojz`（2026-07-21 部分收口）
> 平台：以 macOS 开发态可见问题为主；**不声称 Windows 已验证**。

## 已在本回合修复

| ID | 问题 | 修复 |
| --- | --- | --- |
| THEME-012 | 警告 toast 仍用蓝色 accent，与错误 toast 琥珀系冲突 | `.toast.is-warning` 与 `.is-error` 共用 warning token |
| THEME-013 | 亮色下对话框/过滤面板阴影过重（暗色 42% 黑） | `--shadow-elevated` / `--shadow-panel` / `--shadow-menu` / `--shadow-toast` |
| THEME-014 | 查看页播放错误条硬编码深棕底 | 改为 `warning-muted` + pane mix |
| THEME-015 | 导入冲突下拉高度/圆角与壳层控件不一致 | `decision-field select` 对齐 `--shell-control-height`（交叠 `Serpent-p1rm`） |

顺带：AI 搜索按下态、搜索高亮 mark、inline-error 边框改走 warning token，去掉散落 RGB。

## 仍开放（已有或新开 beads）

| 项 | 说明 | 跟踪 |
| --- | --- | --- |
| 导入冲突下拉视觉 | 原生 select 与自定义控件混用的剩余打磨 | `Serpent-p1rm` |
| Windows 快捷键（文件夹） | 文件夹新建/重命名/删除 Ctrl 体系与侧栏焦点派发 | `Serpent-vf8x` |
| Windows 去顶栏菜单 | 代码已平台分支；真机验收 | `Serpent-r7gu` → SHELL-024-windows |
| Windows 原生对话框语言 | Main 硬编码中英混杂 | `Serpent-bwb` |
| Inspector 竖图圆角/标题 | 已有相关单 | `Serpent-hhy0`（若仍开） |
| 色卡文案精简 | 已有相关单 | `Serpent-l79c` |
| 系统对照完整走查 | 起始页、设置面板、AI 配置、过滤条各态亮/暗再扫一遍 | `Serpent-b9xo` |

## 快捷键（共享表）

资产命令已有 mac ⌘ / Windows Ctrl 对照；纯数据表见
[`src/shared/platform-shortcut-table.ts`](../../src/shared/platform-shortcut-table.ts)。
文件夹侧栏命令的键盘派发仍属 `Serpent-vf8x`，本 epic 不假装已完成。
