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

- 除评分外的既有 Desktop 写入（元数据、标签、合集、导入、文件操作及 Job 状态）仍在旧路径中，必须逐条评估为短 transaction executor 或可恢复 job phase 后才可迁入；本阶段不把它们错误地套入 15 秒 lease。
- 运行中的长 Job 仍需增补 owner/heartbeat/fencing 后才能在另一个进程打开同一库时精确判断“活跃”与“崩溃遗留”；现有 `status='running'` 原子 claim 不能单独满足这个跨进程恢复语义。
- 跨进程变更通知目前提供可读取的持久 sequence；Desktop/MCP 的订阅或轮询事件接入尚未实现。
- v23→v24 的实现已在 SQLite immediate transaction 内重读版本；当前回归证明迁移后第二次打开可验证 v24，但尚未构造两个独立进程重叠迁移的时序证据，不将其写作“并发迁移已验证”。
- 文件树操作和导入必须把既有恢复日志分段接到 lease/job ownership，不能用长时间持锁的快捷方案。
- `Serpent-y51c.7` 仍需把 Gateway Registry 的低风险写命令映射到上述 Worker 路径，并返回逐项成功/跳过/失败结果；本增量没有提前开放未授权脚本写入。
