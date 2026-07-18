# 2026-07-18 状态同步 CU-B1/B2/B3（Serpent-eaf）

## 根因（非抽象总线漏订）

| Bug | 实质 |
| --- | --- |
| B1 | `removeAssetFromCollection` 无论当前 scope 都强制按合集重搜，覆盖「所有资产」网格 |
| B2 | `loadContent({ trashMode })` 不更新 `allAssetCount` |
| B3 | `workspaceTitle` / 侧栏 active 未排除 `activeSmartCollectionId` |

## 实现

- 移出合集：对齐 batch——仅在浏览该合集时 `chooseCollection`，否则 `reloadCurrentContent`
- 回收站模式也拉取库级 total 并 `setAllAssetCount`
- `browse-nav-active.ts` + NavigationSidebar / workspaceTitle 智能合集分支
- `chooseSmartCollection` 设 `assetScope=all` 并清 discovery

## 验收

SYNC-001 / SYNC-002 / SYNC-003
