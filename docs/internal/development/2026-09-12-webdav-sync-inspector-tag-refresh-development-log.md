# WebDAV 同步后 Inspector 标签不刷新（Serpent-2c462e）

> 日期：2026-09-12  
> 工单：`Serpent-2c462e`  
> 清单：`SYNC-META-003`  
> 规格：[2026-09-11-webdav-sync-followups.md](../implementation/2026-09-11-webdav-sync-followups.md) §5.4

## 现象

双机自动同步：对端给已同步照片加上人手标签后，本机 sqlite 已写入 sidecar，Inspector 仍没有该标签。按 F5（刷新磁盘变化）后仍然没有。换选中项再点回来可以拉到库里的标签。

不要把用户真实库路径或标签名写入仓库。

## 根因

标签已经进库。缺的是 Inspector 重拉：

- `useInspectorAssetMetadata` 的 effect 只依赖 `selectedAssetId`。F5 不改选中项，不调用 `getAssetMetadata`。
- `refreshAssets`（F5）只 `refreshManagedAssets` + 重拉画布/导航，不刷新当前选中项元数据。
- 同步回放可能不发 `asset.changed`，或选中项未变时 Renderer 不重拉 Inspector。
- `sync.progress` complete 的 `filesTotal` 恒为 0，原先只弹 toast，不重拉 Inspector。
- 日志里 `uploads:0, downloads:0` 不计 `upload-metadata` / `download-metadata`，不能据此判断 sidecar 没传。

## 实现

- Inspector 元数据 effect 在 `api` / `library` 就绪后也会拉一次。
- F5 在画布重载后走与 AI 完成后相同的 `refreshAfterAiRef`（`listTags` + `getAssetMetadata` + AI 层）。
- 同步实际发生过后（曾出现 `filesTotal>0` 进度），complete 同样重拉当前选中项。
- `pollRemoteChange` 比较 `metadataHash`。
- `summarize` 把 metadata 动作计入 uploads/downloads。

## 验证

- `npx tsc --noEmit`：通过。
- `npx vitest run tests/worker/sync-engine.test.ts`：1 file / 13 passed（metadata-only `report.uploads === 1`；`metadataHash` 变化时 `pollRemoteChange` 为 true）。

Computer Use、packaged、真实双机 UI 未执行。未写入用户真实同步库。
