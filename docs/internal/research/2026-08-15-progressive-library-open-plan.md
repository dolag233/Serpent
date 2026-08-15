# 打开资源库渐进化方案（Serpent-tumv / LIB-018）

> 日期：2026-08-15
> 触发：用户反馈 7000+ 资产的默认资源库启动 >25 秒，小库秒开。
> 原则：`docs/internal/ui/0006-progressive-loading-ux-principles.md`（禁止同步阻塞加载）。

## 根因（代码证据）

`library.open`（worker/index.ts:894-898）同步调用 `libraryService.openLibrary`
（library-service.ts:29516），后者在返回前同步执行一整串打开后对账。按成本分类：

### 磁盘/文件系统密集（大库下秒级~十秒级，主嫌疑）
1. `refreshManagedAssetsOnOpen`（:29688）→ `refreshManagedAssets`（:29005）：
   全量枚举 Assets 目录（`enumerateManagedSources` 逐文件 stat）+ 与 DB 逐项对账 +
   事务写入。7000 资产 ≈ 7000+ 次磁盘 stat。
2. `reconcileMissingArtifactFiles`（:29679 / :19473）：全表 SELECT 所有 ready
   artifact + **逐文件 lstat + realpath** 磁盘检查。缩略图数量级 ≥ 资产数。
3. `purgeExpiredTrash`（:29682）：回收站过期清理（含文件系统删除）。

### DB 内恢复（毫秒~百毫秒级，保持同步）
4. `reconcileLinkedFolderStatuses`（:29665）——linked 根目录 lstat（linked 数少，
   但其中包含对每个 linked root 的全量枚举？见 refreshManagedAssets 内的事务
   部分——注意 :29033 在 refresh 事务里再次调用。打开路径的单独调用 :29665 成本低）。
5. `recoverFileOperations` / `recoverOperationHistoryTransitions` /
   `recoverInterruptedAiJobs` / `recoverInterruptedThumbnailJobs` /
   `interruptUnfinishedPluginJobs` / `reconcileDefaultIgnoredAssets` —— 崩溃恢复与
   状态对账，纯 DB 查询。
6. `migrateDatabase`（无待迁移时 = checksum 验证，快；有待迁移时必须在打开
   前完成，无法异步）+ `verifyDatabase` + `backfillTrashedFromTombstoneIds`。

### 次要
7. `startAssetWatcher` / `reconcileLinkedWatchers`——文件监视器注册（快）。
8. `enqueueThumbnailJobs(limit:50, priority:100)`——只入队 50 个，快。

## 方案：同步最小打开 + 后台分块对账

1. `openLibrary` 拆分：
   - **同步核心**（保留在 library.open 内）：路径/schema 校验 → 连接 →
     migrateDatabase（必要时）→ verifyDatabase → backfillTrashedFromTombstoneIds →
     write coordinator 订阅 → recoverFileOperations / recoverOperationHistoryTransitions /
     recoverInterruptedAiJobs / recoverInterruptedThumbnailJobs /
     interruptUnfinishedPluginJobs / reconcileDefaultIgnoredAssets →
     startAssetWatcher / reconcileLinkedWatchers → enqueueThumbnailJobs。
   - **后台对账**（新公开方法 `runOpenBackgroundReconciliation(libraryId)`，
     async、每步间 `await` yield 让出事件循环）：reconcileLinkedFolderStatuses →
     reconcileMissingArtifactFiles（分块）→ purgeExpiredTrash →
     refreshManagedAssetsOnOpen（分块/或整跑但异步）。
2. worker `library.open` 处理：`openLibrary` 返回后立即响应 renderer；
   `void` 启动后台对账（setTimeout 0 / queueMicrotask 之后）。
3. 对账产出经既有 `asset.changed` / `library.changed` 事件到达 renderer，
   renderer 已有静默刷新与缩略图 patch 机制（App.tsx:6602 onAssetsChanged →
   reloadCurrentContent；:2845 缩略图 rAF 补丁）。
4. 打开后首屏渲染不再等待磁盘对账：DB 现有数据先渲染（可能含陈旧
   availability），对账完成后安静刷新。这正是 0006 原则要求的行为。

## 风险与保留条件
- refreshManagedAssetsOnOpen 的「外部改动发现」推迟到后台：用户打开后立即看到
  的 availability 可能是旧的（文件已被外部删除仍显示 available），几秒内被
  对账修正。产品可接受（渐进原则），需要用户确认体感。
- 后台对账期间用户写操作竞争：对账事务与写操作由既有 LibraryWriteCoordinator
  串行化；refreshManagedAssets 的磁盘枚举不在事务内持有写锁（核对后确认）。
- 崩溃恢复（recoverFileOperations）保持同步：恢复未完成的文件操作必须在
  用户交互前完成，且是纯 DB 操作。
- 测试：worker 集成测试需断言 open 返回后可立即 listAssets，且对账在后台
  完成后发出 asset.changed（渐进打开专项测试）。
