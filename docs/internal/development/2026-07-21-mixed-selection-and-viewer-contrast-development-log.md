# 2026-07-21 混合选中共通动作 + 查看页图标自动对比

> 工单：`Serpent-koy`、`Serpent-noz`  
> 本回合按任务要求不创建 git commit。

## Serpent-koy（FOLDER-015）

### 问题

FOLDER-013 已支持文件夹卡片与资产混合选中，但右键仍强制落到单文件夹菜单或纯资产多选，共通删除不可用，跳过原因也不覆盖文件夹。

### 方案

1. `browse-selection-menu.ts`：右键命中已选集合且总数 ≥2 → 打开 multi 菜单；否则单选菜单。
2. `menu-skip-report.ts`：文件夹参与回收站/从硬盘处理计数；移动跳过文件夹（`folder` 原因）；混选时附带「标签/合集/AI：跳过 N（文件夹）」。
3. `multi-asset` 描述符增加 `folderIds`；`AssetContextMenu` / `asset-multi-commands` 回收站与从硬盘传入文件夹 id。
4. `App.tsx`：`trashMixedSelection` / `requestSelectionDiskDelete` 顺序处理资产与托管文件夹。

文件夹批量**移动**仍属 `Serpent-vgp`，本增量只跳过并说明原因。

### 验证

- `npx vitest run`：`menu-skip-report` / `browse-selection-menu` / `asset-multi-commands` 通过
- `npm run typecheck` 通过
- Computer Use：未执行 → FOLDER-015 待人类验收

## Serpent-noz（VIEWER-020）

### 问题

查看页边缘 `<>` 与关闭在部分画面上对比不足。

### 方案

1. `viewer-chrome-contrast.ts`：边缘区域采样相对亮度 → `on-dark` / `on-light`。
2. `use-viewer-chrome-contrast`：从查看层 `img`/`video` 采样（切图后短时轮询）。
3. CSS：暗区亮标、亮区暗标 + 轻阴影，兼容闲置渐隐。

### 验证

- `viewer-chrome-contrast` 单测通过
- Computer Use：未执行 → VIEWER-020 待人类验收

## 人类验收

- **FOLDER-015**：混合选中共通删除与跳过原因
- **VIEWER-020**：查看页 <>/关闭自动对比
