# 2026-09-12 非法状态错误码收口（Phase 1：用户可见的资源库变更操作）

> 工单：`Serpent-50c466`（P1）｜ 清单：`ERROR-STATE-001`
> 依据：`docs/internal/reviews/2026-08-21-error-handling-deep-review.md`（「INVALID_IMPORT_DECISION 不得作通用非法状态；已删除/已完成应幂等或专用码」）、`docs/internal/ui/0004-calm-error-and-copy-ux-principles.md` §3/§6

## 1. 问题

用户执行回收站/恢复/永久删除/删除到硬盘/移动/重命名/链接目录操作时，只要状态不成立，Worker 抛的都是 `INVALID_IMPORT_DECISION`，界面显示「**导入冲突处理选项无效。**」——与用户实际动作完全无关，既没有说明原因也没有可做的下一步。

全仓该码共 **73 处**调用点；本次处理其中**用户可见的资源库变更一类（40 处）**。

## 2. 新增的四个专用码（中英文案）

| 码 | 中文 | 英文 |
| --- | --- | --- |
| `ASSET_ALREADY_TRASHED` | 该资产已经在回收站里了。请从回收站恢复，或在回收站中永久删除。 | That asset is already in the trash. Restore it, or delete it permanently from the trash. |
| `ASSET_NOT_TRASHED` | 该资产不在回收站里。请先在浏览区把它移入回收站。 | That asset is not in the trash. Move it to the trash first. |
| `ASSET_NOT_MANAGED` | 该文件在链接文件夹里，不在资源库自己的存储中。Serpent 不会移动或删除链接文件夹里的文件，请在文件管理器中处理。 | That file lives in a linked folder, outside the library’s own storage. Serpent leaves those files where they are — handle it in your file manager. |
| `INVALID_STATE_TRANSITION` | 资源库当前的状态不支持这一步（可能有另一个窗口或后台任务刚改过它）。请刷新磁盘变化后重试。 | That action is not valid in the library’s current state, which another window or background task may have changed. Refresh disk changes and try again. |

`INVALID_IMPORT_DECISION` 保留给真正的导入决策校验（`prepareImport` / `resolveImport`）。

## 3. 处理范围（40 处，按方法）

| 方法 | 处数 | 判定 |
| --- | --- | --- |
| `trashAssets` | 3 | 空/重复 id → `INVALID_STATE_TRANSITION`；链接资产 → `ASSET_NOT_MANAGED`；已在回收站 → `ASSET_ALREADY_TRASHED` |
| `trashSelection` | 4 | 空/重复/超限 → `INVALID_STATE_TRANSITION`；混合条件拆成 链接资产 / 已在回收站 两条 |
| `previewRestoreAssets` | 2 | 空/重复 → `INVALID_STATE_TRANSITION`；资产存在但不在回收站 → `ASSET_NOT_TRASHED` |
| `restoreAssets` | 3 | 同上 |
| `restoreAssetsIfOriginalVacant` | 3 | 同上 |
| `deleteAssetsPermanent` | 3 | 空/重复、批次不一致 → `INVALID_STATE_TRANSITION`；未在回收站 → `ASSET_NOT_TRASHED` |
| `deleteAssetsFromDisk` | 3 | 空/重复、批次不一致 → `INVALID_STATE_TRANSITION`；混合条件拆成 链接资产 / 已在回收站 |
| `deleteAssetsFromDiskAsync` | 5 | 同上（循环内 + 批次后各一处混合条件） |
| `deleteActiveManagedAssetsFromDisk(+WithProgress)` | 2 | 批次与查询结果不一致 → `INVALID_STATE_TRANSITION` |
| `deleteLinkedFolderSubtree` / `resolveLinkedDirectoryMutationTarget` | 2 | 链接相对路径非法 → `INVALID_STATE_TRANSITION`（保留 `{ cause }`） |
| `moveManagedFolders` | 1 | 空/重复 id → `INVALID_STATE_TRANSITION` |
| `moveAssets` | 2 | 空/重复、源不是活跃 managed → `INVALID_STATE_TRANSITION` |
| `copyAssets` | 2 | 空/重复、链接行混杂 → `INVALID_STATE_TRANSITION` |
| `renameAssetFiles` | 1 | 空/重复 items → `INVALID_STATE_TRANSITION` |
| `deleteLinkedAssets` | 3 | 空/重复/超 20 → `INVALID_STATE_TRANSITION`；资产存在但不是链接资产 → `INVALID_STATE_TRANSITION` |
| `relinkAsset` | 2 | 已在回收站 → `ASSET_ALREADY_TRASHED`；资产不是 missing → `INVALID_STATE_TRANSITION` |

混合条件（`location_kind !== 'managed' || deleted_at !== null`）原来是"一个条件两个原因"，本次**拆成两条独立判断**，分别给 `ASSET_NOT_MANAGED` / `ASSET_ALREADY_TRASHED`，这样文案能说出真正的原因（不是补丁式地换个码）。

## 4. 测试与证据

```
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/trash-relink.test.ts
→ Test Files 1 passed / Tests 88 passed | 2 skipped（其中 11 条断言从 INVALID_IMPORT_DECISION 改为新码）

node node_modules/vitest/vitest.mjs run tests/unit/error-state-transition-copy.test.ts
→ 9 passed（每个新码都有中英文案、messageForCode 解析到自己的文案而不是 fallback、且文案里不含「导入」/import conflict）

npm run test:library-availability
→ Test Files 9 passed (9) / Tests 211 passed | 1 skipped（含 library-service 28、migration-discipline、schema 链）

tsc --noEmit / eslint → exit 0
```

`tests/worker/trash-relink.test.ts` 的 11 条断言按场景改为：linked 资产 trash → `ASSET_NOT_MANAGED`；重复 trash → `ASSET_ALREADY_TRASHED`；restore 活跃资产 → `ASSET_NOT_TRASHED`；restore 重复 id → `INVALID_STATE_TRANSITION`；永久删除活跃资产/混合批次 → `ASSET_NOT_TRASHED`；重复 id → `INVALID_STATE_TRANSITION`；`deleteLinkedAssets` 重复 id / 对 managed 资产 → `INVALID_STATE_TRANSITION`；relink 可用资产 → `INVALID_STATE_TRANSITION`；relink 已回收站资产 → `ASSET_ALREADY_TRASHED`。

## 5. Phase 2（本次未做，剩余 33 处）

剩下的调用点属于**另一类根因（输入/模式/格式校验）**，每类需要自己的码与文案，不宜塞进本次四个码里：

- 智能合集定义解析：`createSmartCollection:31801`、`updateSmartCollection:31929`、`parseSmartCollectionDefinition:32030`
- 忽略规则/路径规范化：`normalizeLinkedFolderRule:38210-38225`、`normalizeExplicitIgnorePath:38235`、`setIgnore:38582`
- 图片序列：`createImageSequence:16570-16596`、`setImageSequenceFps:16657`
- 文本资产读写：`readTextAsset:33927/33969`、`saveTextAsset:34032`
- 其他：`previewAutomationFileOperation:11122/11130`、`setLinkedFolderRules:15840`、`copyLinkedAssetsToManagedFolder:16028`、`clearAiContent:19490/19506`、`generateThumbnail:21094`、`resolveModelCompanions:26860`、`enqueueArtifactRetry:26906`、`placeManagedRelinkFile:32294/32354`
- `resolveImport:41084-41094` 属**正当用法**（导入决策本身），保持。

另有一项**行为层面**的改进来自同一份审查报告，本单未做（需要产品口径）：永久删除/回收站对"已完成"的批次改为**幂等成功**而不是报错。现在重复点仍会得到上面的专用码提示。若要改成静默幂等，请单独开单确认交互。

## 6. 未验证 / 边界

- packaged / Windows 打包态：未执行（Windows 开发态由 worker 测试覆盖）。
- 人类验收：见清单 `ERROR-STATE-001`（连续 trash、对活跃资产 restore/永久删除、链接资产 trash 四种情况的文案）。
- 同一批次的**部分成功**语义未改：一个非法项仍会让整批失败（除了本来就标注 skipped 的场景）。
