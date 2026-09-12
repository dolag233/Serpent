# WebDAV 同步后 UI 不刷新（Serpent-7043e1）

> 日期：2026-09-12  
> 工单：`Serpent-7043e1`  
> 清单：`SYNC-UI-001`  
> 规格：[2026-09-11-webdav-sync-followups.md](../implementation/2026-09-11-webdav-sync-followups.md) §3.3

## 现象

双机自动同步：机器 A 在已有文件夹 K 下新增子文件夹 L（内有资产）后，机器 B 同步完成，侧栏仍只显示 K。标签等信息可以自动同步。对端关闭再开后标签能跟上但偏慢，本轮不处理。

## 根因

Renderer 靠 `asset.changed` 重拉导航（`setFolders`）和画布。同步回放为避免 `applySyncRelocate` / 下载导入再触发一轮 `sync.run`，此前：

- `emitClientAssetsChanged` 在 `syncReplayDepth > 0` 时直接丢弃；
- `applySyncRelocate` 完全不广播；
- 下载导入虽然会发 `source=client`，调度器会当成用户改动再同步。

结果是「本地库已写入新文件夹，UI 仍用开库时的文件夹快照」。规格原先允许的替代方案是 `source: 'sync'` 且调度器忽略，本轮落地。

空文件夹仍按文件布局不同步（没有资产就不 MKCOL）。若 L 里没有任何文件，对端刷新后也看不到 L。

## 实现

- `asset.changed.source` 增加 `sync`。
- 回放中的 `client` 广播改成 `sync`；`applySyncRelocate` / 内容覆盖 / 墓碑回收走同一通道。
- `SyncAutoScheduler` 忽略 `source === 'sync'`。
- Renderer 把 `sync` 与 `client` 一样做静默刷新（含文件夹树），不弹磁盘变更 toast。

## 验证

- `npx tsc --noEmit`：通过。
- `npx vitest run tests/unit/sync-auto-scheduler.test.ts tests/unit/protocol.test.ts`：2 files / 120 passed（含 `source=sync` 不调度、协议接受 `sync`）。
- `node scripts/ensure-native.mjs` + Electron vitest：`test:library-availability` 全套 + `managed-move` / `sync-library-integration` / `sync-two-device`：12 files / 233 passed / 1 skipped。

真实双机 UI、Computer Use、packaged 未执行。临时测试目录用完即删；未写入用户真实同步库。
