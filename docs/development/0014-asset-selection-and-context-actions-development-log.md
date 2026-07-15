# 切片 0014 开发日志：资产选择与上下文操作

> 状态：macOS 开发态功能收口；最终全量门禁、packaged 与 Windows 待完成
>
> 实现候选：`f1330a7`
>
> 最后校准：2026-07-16

## 范围与结果

- 平铺/瀑布流框选；Shift 范围选择；Command/Ctrl 增减；Command/Ctrl+Shift 追加。
- 瀑布流边缘自动滚动会累计沿途命中，首项、中间项和末项不会因离开视口而丢失。
- 第一层 Esc 关闭菜单并保留选择，第二层 Esc 清空选择。
- 资产、标签、合集、智能合集共用 `ContextMenuProvider`、统一定位、样式与关闭机制。
- 单选和多选菜单均显示可见的“已选择 N 项”；混合 managed/linked/missing 选择显示处理数、跳过数和原因。
- 标签、合集、移动、回收站、复制等动作使用菜单打开时的 `assetIds` 快照。
- 选择相关的移动、删除、恢复、永久删除、链接删除、找回和 AI 分析均已迁入右键菜单；多选后顶部不再出现遮挡画布的动作。
- 回收站单选/多选菜单提供恢复与永久删除；全局“清理到期项目”和批量重新定位仍保留在工作区工具栏，因为它们不是当前选择动作。

## Renderer 拆分

`App.tsx` 从约 8,947 行下降到约 5,600 行。选择、批量动作、资产菜单、导航、检查器、图标、错误转换及各业务对话框已拆成独立模块，并全部进入 `f1330a7`。

关键入口：

- `src/renderer/useAssetSelection.ts`
- `src/renderer/useBatchActions.ts`
- `src/renderer/AssetContextMenu.tsx`
- `src/renderer/context-menu.tsx`
- `src/renderer/NavigationSidebar.tsx`
- `src/renderer/InspectorPanel.tsx`

## 本轮缺陷与修复

| 缺陷 | 结果 |
| --- | --- |
| 跨视口框选只保留当前视口命中 | 改为累计沿途命中，E2E 断言首项、末项和视口外新命中 |
| 菜单执行对象随背景选择变化 | 所有批量动作接收 descriptor 快照 |
| 混合选择静默跳过部分资产 | 显示处理数量、跳过数量及具体原因 |
| 单选菜单缺少数量和 unavailable 原因 | 增加“已选择 1 项”、可见说明与可访问名称 |
| 选择后顶部仍出现移动/删除动作 | Computer Use 发现后迁入右键菜单并增加 E2E 回归 |
| E2E profile 与 macOS Meta 写死 | 增加独立 profile；按平台选择 Meta/Control |

## 验证记录

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- relink crash-recovery Worker：11/11。
- 选择/菜单/移动/链接/回收站定向 Electron E2E：26/26。
- 最近一次完整主线检查点（迁移最后一组顶部动作之前）：885 passed、1 skipped；搜索性能 4/4；Electron E2E 44/44。
- 最后一组动作迁移后的 `verify:mainline` 被用户中断，未作为最终证据；后续只在约定的集中验收窗口重跑，避免 Electron 窗口干扰前台使用。

## Computer Use 产品验收

在隔离资源库 `/private/tmp/serpent-review-ui-20260715/验收测试库` 上完成：

- 31 项资产可见且缩略图实际解码。
- Computer Use 首次发现多选后顶部仍有“移动到文件夹 / 删除”动作，判定不通过并修复。
- 修复后多选顶部不再出现选择动作；右键菜单显示“已选择 31 项”。
- 单资产菜单显示“已选择 1 项”；不可用 AI 动作包含“尚未配置 AI API Key”原因。

截图：

- [资源库进入态](../qa/evidence/0014-selection-context/01-library-entry.png)
- [缺陷：顶部仍出现选择动作](../qa/evidence/0014-selection-context/02-all-selected-defect.png)
- [修复：顶部动作移除](../qa/evidence/0014-selection-context/03-all-selected-fixed.png)

## 未完成边界

- Windows Ctrl/Ctrl+Shift、Delete、右键事件、长路径和文件占用未验证。
- macOS packaged smoke 未执行。
- 最后一组动作迁移后的完整 `verify:mainline` 未执行。
- 菜单视觉已统一到当前 token，但后续仍可作为持续 UX 打磨范围；不阻塞本轮功能候选提交。
