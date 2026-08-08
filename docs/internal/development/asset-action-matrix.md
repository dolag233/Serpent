# 资产操作动作矩阵

> 日期：2026-07-16
>
> 实现候选：`f1330a7`
>
> 目的：确保 UI 重构不丢失单项、批量和回收站动作

## 入口对照

| 操作 | 单选右键菜单 | 多选右键菜单 | 全局工具栏 | 键盘 |
| --- | --- | --- | --- | --- |
| 使用外部应用打开 | ✅ | — | — | — |
| 移动到文件夹 | ✅ managed + available | ✅ 可用 managed 子集 | — | — |
| 移入回收站 | ✅ managed + available | ✅ managed 子集 | — | Delete / Backspace |
| 复制到外部目录 | ✅ managed + available | ✅ 可用 managed 子集 | — | — |
| 找回缺失资产 | ✅ managed + missing | — | 批量重新定位 | — |
| 删除链接资产 | ✅ linked | — | — | — |
| 恢复回收站资产 | ✅ | ✅ | — | — |
| 永久删除 | ✅ | ✅ | 清理到期项目 | — |
| 添加标签 | ✅ | ✅ | — | — |
| 移除标签 | — | ✅ | — | — |
| 加入合集 | ✅ | ✅ | — | — |
| 移出合集 | ✅ | ✅ | — | — |
| 从当前合集移除 | ✅ | — | — | — |
| AI 分析 | ✅；未配置时显示原因 | — | — | — |
| 清除选择 | — | ✅ | — | Esc |
| 全选 | — | — | — | Command/Ctrl+A |

选择相关动作不再根据选择状态插入顶部工具栏。全局工具栏只保留不依赖当前选择的资源库操作、批量重新定位、清理到期项目、画布设置和系统入口。

## 菜单约束

- 单选和多选都有独立、可见的“已选择 N 项”标题。
- 菜单动作以打开时的 descriptor `assetIds` 为目标快照。
- mixed managed / linked / missing 选择分别展示移动/复制和回收站的可处理数量、跳过数量与原因。
- unavailable 动作同时提供可见说明、`aria-label` 原因和 tooltip。
- 危险动作使用统一 danger 样式并在领域对话框中二次确认。

## 实现位置

| 职责 | 文件 |
| --- | --- |
| 页面状态接线 | `src/renderer/App.tsx` |
| 资产单选/多选菜单 | `src/renderer/AssetContextMenu.tsx` |
| 菜单基础设施 | `src/renderer/context-menu.tsx` |
| 选择与框选 | `src/renderer/useAssetSelection.ts` |
| 批量动作 | `src/renderer/useBatchActions.ts` |
| 检查器 | `src/renderer/InspectorPanel.tsx` |
| 侧栏组织入口 | `src/renderer/NavigationSidebar.tsx` |

不记录易漂移行号；复审时以组件导出名与候选 SHA 定位。
