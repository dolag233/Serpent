# 2026-07-18 空态文案修正 CU-B6/B7（Serpent-m4y）

## 问题

| ID | 现象 |
| --- | --- |
| CU-B6 | 搜索无结果时画布仍显示文件夹空态（「此文件夹为空」等）+ 导入文件/文件夹按钮 |
| CU-B7 | 回收站为空时复用首次导入引导文案（`empty.folderBody`）与导入 CTA |

根因：`App.tsx` 在 `visibleAssets.length === 0` 时只按 `selectedFolder` 在两种文件夹空态标题间切换，未区分搜索收窄与回收站范围。

## 实现

- 新增 `src/renderer/browse-empty-state.ts`：`resolveBrowseEmptyState` 按优先级选择
  1. 有活跃搜索词或 discovery 筛选 → `search`（无导入 CTA）
  2. 回收站 → `trash`（无导入 CTA）
  3. 否则 → `folder`（保留导入 CTA；有选中文件夹用 `empty.folderTitle`，否则用 `empty.folderBody`）
- i18n：`empty.searchTitle` / `empty.searchBody` / `empty.trashTitle` / `empty.trashBody`（zh-CN + en）
- `App.tsx` 空网格渲染改用上述结果（图标、标题、说明、条件导入按钮）
- 单测：`tests/unit/browse-empty-state.test.ts`

## 验收

人类验收条目：`CANVAS-015`（见 `docs/qa/human-acceptance-checklist.md`）。

Computer Use：本回合未执行；移交人工 QA。
