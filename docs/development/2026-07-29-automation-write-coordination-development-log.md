# 2026-07-29：Automation 跨进程写入协调（Serpent-bb56.2）

> 状态：automated-verification（第一阶段）
>
> 基线：共享工作树；本增量尚未单独提交。
>
> 规格：[0023 脚本自动化与 MCP](../implementation/0023-automation-scripting-mcp-framework.md)，决策：[ADR-0021](../adr/0021-independent-first-party-clients.md) 与 [ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md)。

## 目标

为同一资源库被多个 Serpent 进程（Desktop、后续 Script/MCP）同时访问时提供可恢复的写入协调基础。第一条端到端受保护的领域修改是批量评分；它是“搜索名称或标签含 `Ser` 的资产并批量改为 4 星”可安全接入 Gateway 的前置。元数据、标签、合集、Job 状态等现有写路径尚未迁入该边界，不能借这次基础设施改动宣称已受保护。

不把普通锁文件作为正确性边界。锁文件的过期回收没有跨平台可用的条件删除语义，两个回收者可能错误删除新拥有者的锁。租约改由资源库 SQLite 内的原子条件更新维护。

## 实现

- 新增 `library_write_leases`：每库一行，带随机 owner、获取时间和到期时间。获取使用 SQLite 的 `INSERT … ON CONFLICT … WHERE expires_at <= now`，因此不依赖“先读再写”的竞态判断；崩溃后租约到期可被下一进程接管。
- 新增 `library_change_sequence`：每库一个单调序号。对资产、修订、文件夹、标签、元数据、合集、AI 内容、工件、Job、可恢复文件操作和序列图关系的 insert/update/delete 都配置 SQLite trigger。序号与实际写事务同提交/同回滚，而不是命令返回后才尽力递增。
- 新建库在 `library` 行插入后由 seed trigger 建立序号；旧库通过 schema v24 migration 回填。针对已发布 v23 库的升级，`BEGIN IMMEDIATE` 会串行化 v23→v24，并在锁内重新读取版本，避免两个进程并发创建同一批表和 trigger。
- `openConfiguredDatabase` 显式设置 `busy_timeout=5000`、WAL、FULL synchronous 和 foreign keys。短暂的 SQLite 内核锁等待不会提前变成不透明的 `SQLITE_BUSY`。
- Worker 只把 `asset.rating.set` 纳入有界写边界。它先按可配置超时等待可用租约，随后在 `BEGIN IMMEDIATE` 内续约并执行短事务，且只在 commit/rollback 后释放；SQLite 的真实 writer mutex 是 fencing 边界，因此 lease 到期也不会让另一进程插入正在执行的写入。无论竞争发生在租约获取还是 SQLite writer mutex，都会返回稳定的 `LIBRARY_BUSY`；后台日志记录 `write-lease.execute` 的 command type 与库 ID，不暴露路径或 SQLite 文本。
- 网络下载、文件树复制、视频编码、AI 推理等长操作不持有短租约；它们必须经持久 job/file-operation 阶段拆分。这样不会把一次长任务变成不可恢复的全库写锁。

## 测试接缝

1. 两个独立 SQLite connection 竞争同一库租约：只有一个 owner；释放或过期后另一个可接管，旧 owner 不能 renew 或推进序号。
2. `LibraryService` 在真实 schema v24 库上暴露同一 lease 与 change sequence，并证明有界 callback 持有 SQLite writer mutex。
3. 提交后的 tag 变更递增序号，rollback 不递增。
4. Worker command 分类明确只把 `asset.rating.set` 放入 transaction-bound lease；读取与长媒体队列不错误占用短租约。
5. 竞争失败经 Worker public-error 边界成为无路径泄露的 `LIBRARY_BUSY`。

## 已执行验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过。 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/bounded-write-command.test.ts tests/worker/library-write-coordinator.test.ts tests/worker/library-service.test.ts tests/worker/security-durability.test.ts tests/worker/public-error.test.ts` | 5 files、44 tests 通过。 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/linked-folders.test.ts tests/worker/search.test.ts tests/worker/trash-relink.test.ts tests/worker/thumbnails.test.ts` | 211 passed、3 failed、1 skipped；3 项失败均是既有 `Serpent-d112`（thumbnail 启动优先级、trash restore 冲突与重复 ID），本增量未触及对应逻辑。schema v24 迁移与关联的 linked/search 路径通过。 |
| `npm run test` | 完整 Electron Vitest 运行至结束；仍仅报告既有 4 项 Worker 红项：上述 3 项及 `library-export-import` 的 artifact 导入保留（均由 `Serpent-d112` 追踪）。 |
| 定向 ESLint（Worker、协议与测试） | 通过。 |

## 未完成范围

- 运行中的长 Job 中，媒体缩略图队列已接 job lease/heartbeat（丢失时 `JOB_LEASE_LOST` 回队列）；**import**、**managed-move / managed-move-undo**、**managed-copy** 与 **restore** applying 已用 `operation_id` 作为 job lease。
- Desktop Renderer 已通过 `LIBRARY_CHANGED_CHANNEL` 接收 `library.changed`；MCP host 尚未主动订阅推送事件（可轮询 Gateway `library.change-sequence`）。
- Worker / Registry / MCP / 脚本宿主已暴露只读 `library.change-sequence`。
- v23→v24 的实现已在 SQLite immediate transaction 内重读版本；当前回归证明迁移后第二次打开可验证 schema，但尚未构造两个独立进程重叠迁移的时序证据，不将其写作“并发迁移已验证”。
- `Serpent-bb56.2` 已关闭（MCP `library.changed` 推送与并发迁移时序证据已完成）；真实双 Host 旅程和人类验收仍开放。

## 2026-07-31 追加：change-sequence 拉取与跨进程 fencing 集成测试

### 实现

- Worker 协议新增只读命令 `library.change-sequence`（`libraryId` → `{ changeSequence }`），不占用 write lease。
- `automation-readonly` 与 desktop Worker switch 均分发该命令，内部复用 `LibraryService.getChangeSequence`。
- 新增 `tests/worker/automation-write-fencing.test.ts`：覆盖命令可读序号、双 `LibraryService` 实例跨连接 `library.changed` 通知、lease busy、过期 owner 无法 renew。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/automation-write-fencing.test.ts \
  tests/worker/automation-readonly-command-executor.test.ts \
  tests/worker/library-write-coordinator.test.ts
```

结果：3 files、14 tests 通过。`tsc --noEmit` 通过。

## 2026-07-31 追加：Registry/Gateway 映射 library.change-sequence

### 实现

- Registry 新增只读命令 `library.change-sequence`（`library.read`，MCP public `serpent_library_change_sequence`）。
- 脚本 API / QuickJS / 类型声明暴露 `serpent.library.changeSequence()`。
- Gateway 单元测试覆盖绑定读取、未绑定拒绝、错误 Worker 结果。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/automation-command-gateway.test.ts \
  tests/unit/serpent-mcp-adapter.test.ts \
  tests/unit/quickjs-sandbox-prototype.test.ts
```

结果：3 files、58 tests 通过。`tsc --noEmit` 通过。

## 2026-07-31 追加：import applying Job lease fencing

### 实现

- `LibraryWriteCoordinator.claimJobOnce` / `hasLiveJobLease`：同步单次 claim，供 import apply 使用。
- `resolveImport` 在进入 `applying` 前以 `operation_id` claim Job lease 并 heartbeat；`finally` 释放；commit 前 `assertCurrent`。
- `recoverFileOperations` 对仍持有 live lease 的 applying import 跳过回滚并保留 operation 目录。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/automation-write-fencing.test.ts \
  tests/worker/import-planning.test.ts \
  tests/worker/library-write-coordinator.test.ts
```

结果：3 files、50 tests 通过。

## 2026-07-31 追加：managed-move applying Job lease fencing

### 实现

- `applyManagedMoveOperation`（含 undo）在 applying 前 `claimJobOnce` + heartbeat；commit 前 `assertCurrent`；`finally` 释放。
- `recoverFileOperations` live-lease skip 白名单扩展为 `import` / `managed-move` / `managed-move-undo`。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/automation-write-fencing.test.ts \
  tests/worker/managed-move.test.ts
```

结果：2 files、16 tests 通过。

## 2026-07-31 追加：managed-copy applying Job lease fencing

### 实现

- `applyManagedCopyOperation` 在 applying 前 `claimJobOnce` + heartbeat；commit 前 `assertCurrent`；`finally` 释放。
- 注入 `crash-copy-*` failpoints；`SimulatedCrashError` 不内联回滚，保留 `applying` 供 reopen/`recoverManagedCopyOperation` 处理。
- `recoverFileOperations` live-lease skip 白名单加入 `managed-copy`（不含 undo）。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/automation-write-fencing.test.ts \
  tests/worker/managed-copy.test.ts
```

结果：2 files、13 tests 通过。

## 2026-07-31 追加：restore applying Job lease fencing

### 实现

- `restoreAssets` 在 applying 前 `claimJobOnce` + heartbeat；commit 前 `assertCurrent`；`finally` 释放。
- `recoverFileOperations` live-lease skip 白名单加入 `restore`。
- 成功路径返回 `operationId`（供租约对账测试使用；Worker IPC 响应形状未改）。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/automation-write-fencing.test.ts \
  tests/worker/trash-relink.test.ts
```

结果：2 files、93 tests 通过、1 skipped。

## 2026-07-31 追加：MCP `library.changed` 推送

### 实现

- MCP Host 订阅 Main 的 Worker `onLibraryChanged`，按执行记录当前绑定的 `libraryId` 过滤事件；未绑定执行或其他资源库的事件不推送。
- 使用 MCP 标准 `notifications/message`，启用 Server `logging` capability。通知 `data` 仅含 `type: "library.changed"`、`libraryId` 和 `changeSequence`，不含文件系统路径。
- MCP 客户端仍可轮询 `serpent_library_change_sequence`；推送作为低延迟补充，不改变变更序号的读取语义。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/unit/automation-mcp-host.test.ts \
  tests/unit/automation-mcp-bootstrap.test.ts \
  tests/unit/serpent-mcp-adapter.test.ts
```

结果：3 files、14 tests 通过；新增测试覆盖匹配资源库推送、未绑定/不匹配 no-op、关闭时取消订阅及路径不泄露。`npm run typecheck` 待本回合执行。

### 并发 v23→v24 迁移时序证据

- 新增 `tests/worker/library-migration-opener.ts` 子进程 fixture，并在
  `tests/worker/library-service.test.ts` 中用 Vite SSR bundle 启动两个独立
  Electron Node 子进程。
- 两个 opener 先并发进入迁移前接缝；第一个在 `BEGIN IMMEDIATE` 已取得
  writer mutex 后受控等待，第二个已进入 `openLibrary` 并等待同一 SQLite 锁。
  释放第一个后，两个 opener 均成功完成，证明第二个在锁内重读版本而不会
  重复创建 v24 coordination tables/triggers。
- 测试同时核对 `user_version = 26`、`quick_check(1) = ok`、`schema_migrations`
  为 1–26 且无重复、`library_change_sequence` seed 为 0，以及 coordination
  trigger 名称唯一。

### 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/library-service.test.ts
```

结果：1 file、26 tests 通过；包含两个独立 Electron 子进程的重叠迁移时序。

### 未完成范围

- 当前 MCP push 尚无稳定的独立 Electron/MCP 客户端人类验收旅程；见 `AUT-013`。
