# 2026-07-18 合集/智能合集导入 CTA 语义（CU-U5 / Serpent-s75）

## 问题

Computer Use 审计 U5：在合集或智能合集视图中，空态与资源库菜单仍显示「导入文件 / 导入文件夹 / 粘贴图片」等，用户无法判断：

- 导入落在哪个文件夹；
- 是否会自动加入当前合集；
- 智能合集是否支持「导入进合集」。

## 根因与约束

- 对话框导入（`importFiles` / `importFolder`）仅支持 `targetFolderId`，**不**支持 `targetCollectionId`。
- 拖拽导入与剪贴板粘贴**已**支持 `targetCollectionId`（合集视图下粘贴会加入当前合集）。
- 智能合集是查询结果，不是成员容器。
- 按工单要求：优先澄清语义，不为此次新增「对话框导入并加入合集」后端。

## 实现

| 表面 | 行为 |
| --- | --- |
| 空合集 | 专属文案；`showImportActions: false`（无导入 CTA） |
| 空智能合集 | 专属文案；无导入 CTA |
| 空文件夹 / 库根 | 仍保留导入 CTA（既有 CU-B6/B7 行为） |
| 资源库菜单 · 合集范围 | 「导入…到资源库」+ title 说明不自动加入合集；「粘贴图片并加入此合集」 |
| 资源库菜单 · 智能合集范围 | 「…到资源库」+ title 说明智能合集不是成员目标 |

代码：

- `src/renderer/browse-empty-state.ts`：`organizationScope`；新增 `resolveImportMenuCopy`
- `src/renderer/LibrarySwitcher.tsx`：`importMenuCopy` 驱动标签与 `title`
- `src/renderer/App.tsx`：按 `activeCollectionId` / `activeSmartCollectionId` 传入 scope
- i18n：`en` + `zh-CN`（`empty.collection*` / `empty.smartCollection*` / `toolbar.import*ToLibrary*` 等）
- 单测：`tests/unit/browse-empty-state.test.ts`

## 验收

人类验收条目：`CANVAS-016`（见 `docs/qa/human-acceptance-checklist.md`）。

Computer Use：本回合未执行；移交人工 QA。
