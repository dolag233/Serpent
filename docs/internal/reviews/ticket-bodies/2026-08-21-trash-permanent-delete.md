用户反馈（2026-08-19 日志 serpent (2).log）：回收站永久删除后重启资产复现；二次永久删除报「未能分类的内部错误」。

## 根因（审查结论，见 docs/internal/reviews/2026-08-21-error-handling-deep-review.md）

1. 第一次删除可能已成功（后续 metadata.get → ASSET_NOT_FOUND），但 UI 侧栏 trashedAssetCount 未同步，仍显示 1 项。
2. 第二次删除走 deleteAssetsPermanent；Worker 在 createDatabaseBackup 后若资产已不存在则非幂等抛 ASSET_NOT_FOUND；若备份+删除慢于 15s，Main 超时映射 INTERNAL_ERROR + LIBRARY_TRANSFER_TIMEOUT（开库文案），Worker 迟到响应被丢弃。
3. Renderer applyLocalAssetRemoval 乐观更新 toast/标题但不更新 trashedAssetCount；reloadCurrentContent 失败被 .catch(() => undefined) 吞掉。

## 验收

- 永久删除已删资产：幂等成功或返回专用可操作码（非 INTERNAL、非导入冲突文案）。
- asset.delete-permanent / purge-trash / delete-from-disk 使用与 delete-linked 一致的长超时或无墙钟超时。
- 超时不得映射为 LIBRARY_TRANSFER_TIMEOUT 开库文案。
- 永久删除后 trashedAssetCount、画布列表、侧栏一致；reload 失败有可见反馈。
- 补 Worker 单测（幂等/超时）+ 定向 E2E 或 renderer 单测；触及 library-service 须 npm run test:library-availability。
