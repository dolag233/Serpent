# 2026-09-12 拖放无变化时不再提示（冗余提示清扫）

> 工单：`Serpent-374266`（P1）｜ 清单：`TOAST-006`
> 依据：[UI 0004 平静错误与文案原则](../../ui/0004-calm-error-and-copy-ux-principles.md) §4.3「预期内的空结果不打扰」、§6「不要把用户已经能从界面行为里知道的事再解释一遍」

## 1. 反馈

用户 2026-09-12：把文件夹拖动后并未改变位置时，仍提示「不能将文件夹移动到自身。」；这类提示属冗余，要求**扫描所有同类提示**（文件、文件夹、合集都算）。

## 2. 规则

**拖放后如果没有任何改变，就不显示任何提示**；这类目标也不应显示「可放置」高亮——高亮之后什么都不发生，本身就是误导。

## 3. 扫描结果与处理

| 场景 | 原提示 | 处理 |
| --- | --- | --- |
| 文件夹拖到自身 | 「不能将文件夹移动到自身。」 | 静默 + 不再高亮 |
| 文件夹拖到它当前的父级 | 「文件夹已在该位置，无需移动。」 | 静默 + 不再高亮 |
| 文件夹拖到自己的子文件夹 | 「不能将文件夹移动到其子文件夹。」 | 静默 + 不再高亮 |
| 资产拖到它当前所在的文件夹 | 「资产已在当前文件夹，无需移动。」 | 静默 |
| 资产拖到它已经是成员的合集 | 「已将 N 项加入合集」（无变化却报成功） | 先查成员关系：没有新增则静默且不调用 `addCollectionAssets`（也不再产生无意义的历史记录）；有新增则报告**实际新增**数 |

保留（不同类：用户想做的事确实做不到，且界面上看不到原因，属于「无法完成」而非「无变化」）：

- 拖入回收站 / 文件夹 / 合集时「没有符合条件的资产」（已删除、缺失、链接目录资产等）。

## 4. 实现

| 改动 | 位置 |
| --- | --- |
| 文件夹 reject 静默 | `use-folder-drag-drop-handlers.ts`（reject 分支直接 return，不再 `setNotice`） |
| 资产拖到当前文件夹静默 | `use-asset-drag-drop-handlers.ts`（`same-folder` 直接 return） |
| 合集已是成员 → 静默 | `asset-drag-drop.ts` 新增 `resolveNewCollectionMembers`；`use-asset-drag-drop-handlers.ts` 投放前先 `listAssetCollectionMemberships`，无新增则不添加、不提示，提示数量改为实际新增数 |
| 无效目标不再高亮 / 不接收 drop | `NavigationSidebar.tsx` 新增 `acceptsFolderDrop(target)`（复用 `resolveFolderOntoFolderDrop`）：目标无效时不设 `dropActive`，且 `dragover` 不 `preventDefault`（这次 drop 根本不成立） |
| 拖拽 id 快照 | 侧栏行的 `onDragStart` 记录 ids（HTML5 在 dragenter/dragover 期间处于 protected mode，`getData` 读不到 payload）；浏览区文件夹卡片经新 prop `getManagedFolderDragIds` 提供；两者都拿不到时 **fail open**（保持原高亮行为，提示依然是静默的） |
| App 侧快照 | `App.tsx` 镜像既有 `managedAssetDragIdsRef` 模式，新增 `managedFolderDragIdsRef` / `getManagedFolderDragIds`，并在 window `dragend`/`drop` 清理 |
| 文案清理 | 删除 4 个已无用的 i18n 键（中英）：`toast.folderAlreadyThere`、`toast.folderMoveIntoSelf`、`toast.folderMoveIntoDescendant`、`toast.alreadyInFolder` |

## 5. 测试与证据

```
node node_modules/vitest/vitest.mjs run tests/unit/navigation-sidebar.test.ts tests/unit/folder-drag-drop.test.ts tests/unit/asset-drag-drop.test.ts
→ asset-drag-drop 15 passed、folder-drag-drop 10 passed、navigation-sidebar 17 passed
  （同文件 4 条既有用例在本机 Node v26 下失败，见 §6）

node scripts/run-e2e.mjs tests/e2e/nav-pane-background.test.ts
→ 1 passed（真实 Electron：拖到自身行时 `.nav-row.is-drop-target` 数量为 0 且 toast 文本完全未变；
   对照用例拖到 Alpha 行仍高亮 1 个目标并成功改父级 + 出现「已移动 1 个文件夹。」）

node node_modules/typescript/bin/tsc --noEmit   → exit 0
node node_modules/eslint/bin/eslint.js <改动文件> → exit 0
```

新增单测：

- `tests/unit/asset-drag-drop.test.ts`：`resolveNewCollectionMembers` 只保留未加入的资产 / 全部已是成员时返回空。
- `tests/unit/navigation-sidebar.test.ts`：无效目标（当前父级、自身）不高亮；有效目标（换父级）仍高亮；已在根目录的文件夹拖到空白区也不高亮。

## 6. 环境问题（与本次改动无关）

本机 Node 为 **v26.0.0**，项目要求 `>=24 <25`（`.nvmrc` = 24.15.0）。Node 26 自带 `localStorage` 会遮蔽 happy-dom 注入的 web storage，`NavigationSidebar` 中 4 条既有用例挂载即失败（`LocalePreferences: no storage provided`）。已用 `git stash` 基线对照确认与本次改动无关，需在 Node 24 下复跑。

## 7. 未验证项

- packaged / Windows：未执行。
- 资产的两条（拖到当前文件夹、拖到已是成员的合集）目前只有纯函数 / 单测覆盖（`resolveFolderDrop`、`resolveNewCollectionMembers`）；真实 Electron 旅程需要构造资产 + 合集夹具，本轮未做，已记在工单里。
- 「fail open」路径（拖拽来源既非侧栏行也非画布文件夹卡片）未构造用例。
