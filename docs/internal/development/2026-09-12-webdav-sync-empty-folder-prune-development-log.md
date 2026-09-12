# 2026-09-12 同步搬家后剪除对端空目录

工单：`Serpent-546f1a`（本轮实现）
关联：`Serpent-038ecf`（MOVE 规划，不扩范围）；`Serpent-e71051` / `Serpent-fa76a7`（侧栏空白回根，只记录）

## 现象

机器 A 移动或重命名已同步的文件夹/文件后，机器 B 能同步到新位置，侧栏和磁盘仍留着旧路径上的空目录。

## 根因

交换格式按文件布局。`applySyncRelocate` 把资产搬到新相对路径，并用 `ensureManagedFolderIdForRelativeDir` 建目标文件夹，不删除源 `managed_folders` 行。空文件夹本身不上远端，所以也没有删除指令。

## 行为

同步回放 relocate 之后，从源文件夹沿父级向上：没有子文件夹、没有托管资产、磁盘目录可以 `rmdir` 的，删除索引行并去掉空目录。仍有文件或子文件夹的保留。磁盘目录已经不在时仍删除索引，避免侧栏幽灵空目录。不进应用回收站。链接文件夹不同步，不在本范围。

## 实现

- `LibraryService.pruneEmptyManagedFoldersAfterSyncRelocate`，由 `applySyncRelocate` 在 managed-move 之后调用。

## 验证

- 定向：`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/sync-library-integration.test.ts tests/worker/sync-two-device.test.ts` → 2 files / 19 passed。
- `npm run test:library-availability` → 9 files / 209 passed / 1 skipped。
- Computer Use、packaged、真实 WebDAV 双机：未执行。不要把真实库名或路径写入仓库。
