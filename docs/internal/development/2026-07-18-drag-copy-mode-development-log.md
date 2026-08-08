# 2026-07-18 — Option/Alt 拖拽复制模式（Serpent-aa3）

> 状态：实现完成（待人类验收 DND-005）；不宣称 managed 文件「复制到文件夹」已交付。

## 范围

- 检测拖拽过程中的 `altKey`（macOS Option / Windows Alt），在 `dragover`/`drop` 上将 `dropEffect` 设为 `copy` 或 `move`。
- 拖拽预览在 copy 模式显示「+」徽标（可在拖拽中途随修饰键切换）。
- 托管文件夹 drop：copy 模式明确拒绝（toast），不静默改走 move。
- 合集 drop：move/copy 均为 membership-add（`addCollectionAssets`），不从源文件夹或源合集移除。
- 链接资产：文件夹/回收站仍按既有 skip；合集允许链接资产加入（与菜单一致）。

## 实现位置

| 模块 | 说明 |
| --- | --- |
| `src/renderer/asset-drag-drop.ts` | `resolveDragDropMode` / `resolveManagedDropEffect`；`resolveFolderDrop` 增加 `copy-unsupported`；新增 `resolveCollectionDrop` |
| `src/renderer/asset-drag-preview.ts` | `copyMode` / `showCopyBadge`；`setAssetDragPreviewCopyMode` |
| `src/renderer/NavigationSidebar.tsx` | 文件夹/合集 `dropEffect`；合集接受 managed 资产 drop；回收站固定 move |
| `src/renderer/App.tsx` | `effectAllowed = "copyMove"`；文件夹/合集 drop 执行器；预览徽标回调 |
| i18n `toast.folderCopyUnsupported` 等 | 中英文 |

## 自动化

- `tests/unit/asset-drag-drop.test.ts` — copy 拒绝、合集两侧 membership-add、链接/回收站 skip
- `tests/unit/asset-drag-preview.test.ts` — copy「+」徽标模型

## 诚实边界 / 待澄清

**Managed 资产「复制到文件夹」（物理文件 duplicate）尚未支持。**

仓库现有相关 API：

- `moveAssets` — 移动托管文件 + 更新路径（move 模式使用）
- `copyAssetsToLinkedFolder` — 复制到**链接/外部**目录，不是库内托管文件夹 duplicate
- **没有**「在托管文件夹间复制/克隆资产文件并新建 asset 身份」的 worker 命令

因此 Option+拖到托管文件夹走拒绝 toast：`复制到文件夹尚未支持，松开 Option 以移动`，避免发明不透明的 duplicate 语义。

若产品确认需要 Finder 式「Option+拖 = 库内复制一份文件」：

1. 需澄清：新 `asset_id`？文件名冲突策略？缩略图/元数据是否克隆？是否计入配额/导入管道？
2. 新增 worker 命令 + 协议后再把 `copy-unsupported` 换成真实 copy 路径。

合集侧语义已固定为 membership-add（与 Eagle/合集模型一致），不依赖上述文件 duplicate 澄清。

## 人类验收

- 清单项 **DND-005**（待人类验收）。
- Computer Use：本环境未执行真实桌面拖拽验收，移交人工 QA。
