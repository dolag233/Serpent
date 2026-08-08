# 2026-07-18 递归视图资产来源标识（Serpent-mvn / CU-U1）

## 范围

递归（「包含子文件夹」）视图中，来自子文件夹的资产卡片缺少来源标识，无法区分直属资产与后代文件夹资产。

## 前置

- REQ-FOLDER-009 / FOLDER-009 已实现且人类验收通过（显式「包含子文件夹」开关，默认关闭）。
- `AssetSummary.managedFolderId` + 侧栏 `ManagedFolderSummary.relativePath` 已足够解析来源，无需扩展协议。

## 实现

- `src/renderer/asset-source-badge.ts`：显示条件与标签解析（相对当前文件夹路径优先，否则库相对路径）。
- `App.tsx`：卡片预览左上角紧凑 chip；回收站不显示；逻辑不内联膨胀。
- `styles.css`：`.asset-source-badge`（顶左，避开时长/类型/扩展名角标）。
- i18n：`scope.containingFolder`（中/英，用于 `title` / `aria-label`）。
- 单元测试：`tests/unit/asset-source-badge.test.ts`。

## 显示规则

| 浏览面 | 何时显示 |
| --- | --- |
| 文件夹范围 | `managedFolderId !==` 当前文件夹（递归开启后的子级资产） |
| 所有资产 / 搜索 / 标签 / 合集 / 智能合集 | `managedFolderId != null` |
| 资源库根目录（非混合） | 不显示 |
| 回收站 | 不显示 |

## 验收

- CANVAS-017（待人类验收）

## 未执行

- Computer Use / 真实 Electron 视觉验收；移交人工 QA。
- Windows 未验证。
