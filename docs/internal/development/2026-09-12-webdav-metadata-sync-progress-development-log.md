# 元数据同步进度可见（2026-09-12）

## 范围

用户改资产标签后界面没有「正在同步 / 已同步」。工单 `Serpent-8fa7b3`。

## 根因

自动同步会在 `asset.changed` 后约 10 秒跑 `sync.run`。Renderer 只在 `sync.progress` 且 `filesTotal > 0` 时弹 toast。进度原先只在读写媒体内容时回调；`upload-metadata` / `download-metadata` 不增加 `done`，也没有起步 `0/total`。只改 sidecar 的会话被当成空跑。

`renameTag` / `deleteTag` / `mergeTags` 也不发 `asset.changed`，改标签名不会触发自动同步。

## 实现摘要

- `syncOnce` 在有动作时立刻 `onProgress(0, total, …)`，每个动作结束再 `done++`。
- 重命名、删除、合并已用标签时发 `asset.changed`。

## 验证

- `npx tsc --noEmit`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/sync-engine.test.ts tests/worker/organization.test.ts`：2 files / 78 passed（含 metadata-only 进度与 rename 发事件）。
- `tests/worker/sync-runner.test.ts`：1 file / 9 passed。
- `npm run test:library-availability`：9 files / 209 passed / 1 skipped。

Computer Use、packaged、真实双机未执行。清单 `SYNC-META-002` 待人点验 toast。
