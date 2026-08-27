# 2026-08-26 大型资源库性能架构阶段 E 开发日志：watcher、稳定文件窗口与网络扫描

关联架构：[`0032-library-performance-architecture.md`](../implementation/0032-library-performance-architecture.md)  关联工单：`Serpent-3kfe`、`Serpent-4bdd26`、`Serpent-04ba9d`、`Serpent-6c5c65`

## 根因

旧 watcher 路径把 managed root 和每个 linked root 的事件分别 debounce，事件风暴会
触发多个全量 refresh；refresh 中又可能同步走较长的发现/SQLite 对账。复制中的文件
还可能在第一次 rename/write 事件时被当作完整 revision。对 NAS/SMB，`fs.watch` 更不
能作为跨机可靠通知源，重复 lstat 和远端往返会把后台维护放大成秒级停顿。

## 实现与四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| managed/linked watcher 在 library 级合并为一个 timer/promise，事件风暴只保留 trailing pass | `src/worker/library-service.ts` `WatchRefreshState`、`scheduleWatcherRefresh`、`finishWatcherRefresh` | `tests/worker/library-watcher.test.ts`：事件风暴与 reconciliation 中再次事件 | macOS Worker 12 项监听器回归通过；真实 SMB/NAS watcher 未执行 |
| watcher refresh 复用 generation owner，不与 open reconciliation 并行访问 DB | `runWatcherReconciliation`；`OpenReconciliationTask.reason`；`refreshManagedAssetsOnOpen` | `tests/worker/library-watcher.test.ts`；`tests/worker/reconciliation-performance.test.ts` | Worker 单独运行对账性能用例通过；进程重启和 Windows 未验证 |
| changed/new 文件经过 size/mtime 稳定窗口，不把复制中间态提交为 revision | `waitForStableWatcherDiscovery`；生产默认 200ms，变化中的 entry 最多 3 次采样后留给 trailing event | `tests/worker/library-watcher.test.ts`；`tests/worker/database-recovery.test.ts` 相关恢复路径 | 本地文件系统自动化通过；SMB/NAS 网络抖动未验证 |
| 网络库不注册 managed-root 高频 watcher，低频扫描按路径/大小/mtime checkpoint 跳过未变化树 | `networkScanByLibrary`、`startNetworkScan`、`networkDiscoveryFingerprint`；`storageKindOverrideForTests` 仅用于测试 | `tests/worker/library-watcher.test.ts` 网络扫描 checkpoint 测试 | 仅 macOS 本地模拟 network storage；真实 SMB/NAS 目录往返、断线/恢复未验证 |
| 忽略目录在进入目录前剪枝、symlink 不入库 | `enumerateSourcesAsync` managed/linked ignore checks | `tests/worker/library-watcher.test.ts` symlink/默认忽略回归；library availability | 本地 Worker 证据通过；网络盘权限/断线未验证 |
| 文件操作中途进程退出后由新 Worker 对账并回滚未完成操作 | `LibraryService` operation manifest recovery、`terminateProcessAt` failpoint、`src/worker/index.ts` E2E failpoint wiring | `tests/e2e/file-operation-process-recovery.test.ts` | 当前 macOS 隔离 Electron：完整父/子进程终止、等待 16 秒 lease window、重启后 DB/磁盘/manifest 对账通过；Windows/NAS 未验证 |

## 设计细节

- `WatchRefreshState` 同时承载 dirty、debounce timer 和 active promise。刷新期间新事件
  不启动并行扫描，只在完成后安排一个 trailing pass；close 会取消 timer，并让 generation
  abort 保护异步发现不能触碰已关闭连接。
- 稳定窗口只对相对于数据库 size/mtime 有变化的候选执行额外 lstat；安静的大库不为
  每次 watcher 事件支付第二次全量 stat。不可访问或持续变化的 entry 从本次提交中
  暂时移除，下一次事件再试，避免 partial revision。
- network timer 使用同一 coalescing refresh owner，但 discovery 完成后先计算不含内容
  hash 的 fingerprint。路径、大小、mtime 均未变化时不做 SQLite compare、revision hash
  或 artifact admission；网络根目录打开/断开通过 diagnostic scope 记录，不把缓存预览
  误当成远端源文件可用。
- 现有 `file_operations` manifest、分批事务、恢复扫描和 artifact/browse cache
  invalidation 已覆盖多数文件操作状态机；本轮新增的是“真实进程消失”边界，而不是
  把同一 Worker 的 close 当成重启。文件已放置但 DB 尚未提交时，恢复扫描会依据
  manifest/lease 将操作标记为 rolled back，并清理临时/目标路径；DB、磁盘和 manifest
  都在重启后的断言中核对。

## 验证记录

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/library-watcher.test.ts`：12 passed。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts --no-file-parallelism tests/worker/reconciliation-performance.test.ts tests/worker/library-watcher.test.ts`：2 files / 16 tests passed。
- `npm run test:library-availability`：9 files / 203 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/file-operation-process-recovery.test.ts`：1 passed，
  22.4s；测试实际终止 Electron 父/子进程，等待 16 秒 lease window，重启后确认
  `rolled_back|PROCESS_INTERRUPTED`、目标文件不存在、磁盘快照稳定且 operations 目录为空。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts --no-file-parallelism tests/worker`：
  84 files passed、13 skipped；1,219 tests passed、20 skipped。并行宿主负载下曾出现既有
  reconciliation P95 门槛红灯，已用 `--no-file-parallelism` 单独复测，不把重跑当作消除平台波动。
- `npm run typecheck`、受影响文件 ESLint、`git diff --check`：当前工作树通过。
- 本阶段没有真实 SMB/NAS、Windows、packaged、完整进程重启断点或 Computer Use 证据；不能标记 Stage E 完整验收。

## 未完成

网络库低频 checkpoint、本地 watcher coalescing 和文件操作完整进程恢复路径已落地；
网络断线 UI 状态、真正 NAS 往返性能、跨实例断线恢复和 Windows 恢复仍待独立测试与
平台证据。`Serpent-04ba9d` 保持 open，`Serpent-4bdd26` 的性能修复证据需在真实 NAS
补齐后再关闭。
