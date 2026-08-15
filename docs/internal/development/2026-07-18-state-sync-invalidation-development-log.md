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

### 2026-08-04 回收站侧栏计数补充

- 根因：Renderer 的 `onAssetsChanged` 刷新逻辑本身会重载当前内容并重算 Trash total，但 Worker 的 `trashAssets`、`restoreAssets`、`deleteAssetsPermanent` 成功路径没有发 `asset.changed`。因此当前窗口手动操作可能看起来正常，插件、自动化、其他窗口或后台操作却不会让侧栏计数更新。
- 修复：三个 Worker mutation 在文件/数据库提交成功后发送 `asset.changed`（`source: client`），由既有 Renderer 订阅统一刷新库级 Trash total；失败、回滚和零实际删除不发送伪事件。
- 回归：`tests/worker/trash-relink.test.ts` 新增移入回收站、恢复、永久删除三段事件断言。

## 验收

SYNC-001 / SYNC-002 / SYNC-003
