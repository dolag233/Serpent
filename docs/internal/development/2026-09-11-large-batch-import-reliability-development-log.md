# 大批量导入可靠性开发日志（2026-09-11）

## 范围

本轮收口 `Serpent-d4d79f`、`Serpent-3d4290`、`Serpent-41c7e1`、`Serpent-d1280f`、`Serpent-8fadb4`，对应设计文档 `docs/internal/implementation/2026-09-11-large-batch-import-reliability.md`。

## 实现摘要

- 新增 `src/worker/sqlite-in.ts`，把 SQLite 动态 `IN` 的查询与更新统一按 900 个绑定参数分块；双 `IN` 关系查询使用更小的成对分块。导入后处理、序列摘要、刷新对账，以及资产/标签/合集/回收站/恢复/移动复制等大批量选择路径均已接入。
- `resolveImport` 以文件与数据库提交为边界；序列检测、逻辑计数和结果卡片查询均为提交后的独立可恢复步骤。后处理失败时仍返回成功完成结果并写诊断；已提交 import token 在短时窗口内对迟到的 cancel/abandon 保持幂等。
- 进程中断恢复在 applying 的 v1 导入中先核对目标路径是否已经有活动资产记录；已登记目标保留并标记 `PROCESS_INTERRUPTED_RECOVERED`，未登记的孤儿目标才清理。
- 冲突决策默认 TTL 从 15 分钟调整为 24 小时，避免大库导入在用户作决定前静默丢弃暂存内容。
- Renderer 在 resolve/取消失败路径清理进度状态；冲突取消说明明确表示丢弃资源库暂存副本、保留源文件夹；导入资源库复制阶段报告文件数与字节数。

## 自动化证据

以下命令均基于本轮工作树执行：

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/sqlite-in.test.ts tests/worker/import-planning.test.ts tests/worker/pending-import-lifecycle.test.ts tests/worker/library-export-import.test.ts tests/unit/import-progress-overlay.test.tsx tests/unit/import-progress-copy.test.ts`：6 个测试文件通过，98 项通过，1 项既有跳过。
- `npm run test:library-availability`：9 个测试文件通过，209 项通过，1 项跳过。
- `npm test`：534 个测试文件通过、1 个失败、15 个跳过；4,589 项通过、1 项失败、27 项跳过。唯一失败为本轮未覆盖的 `tests/worker/reconciliation-performance.test.ts` 事件循环性能基准，`p95LagMs=85.27ms` 超过 75ms 门槛（`maxLagMs=333.1ms` 仍低于 1,000ms）；当前证据不足以将该宿主机调度波动归因于本轮改动。因此全量测试不是全绿，但本轮新增与资源库可用性门禁均通过。

## 验收边界

`IMPORT-UI-005`、`IMPORT-UI-006`、`IMPORT-SQL-001`、`IMPORT-RECOVER-001` 已加入 `docs/internal/qa/human-acceptance-checklist.md`，状态保持“待人类验收”。真实 10w+ Eagle 用户库、Windows 真机、packaged、Computer Use 和独立进程桌面验收未在本轮执行，不能以自动化结果替代。

## 代码审查

独立双轴审查已沉淀：`docs/internal/reviews/2026-09-11-large-batch-import-reliability-review.md`（composer-2.5，Standards 与 Spec 各一次）。Standards 0 hard / 5 judgement，最重是其余动态 `IN` 未分块扫完。Spec 最重是 §5.5「决策期暂停 TTL」未实现，只改了 24h 默认到期。真实 10w+ 库、Windows、packaged 与 Computer Use 仍是验收边界。

## 审查收口（同日续）

- `withSqliteInPredicate`：超过 900 个绑定的 ID 列表改走 TEMP 表，避免把 `OR IN` 拼进同一语句仍超限。`listAssets`、回收站、缩略图映射、标签合并、合集封面等用户规模 `IN` 已接入；编译期小集合（job kind / status）仍内联。
- §5.5：决策中的 pending import 只取消既有 timer，不再排期到期；关库 / abandon / resolve 仍清理暂存。
- 补测：`sqlite-in` TEMP 表 2500 ID；`pending-import-lifecycle` 24h 仍可 resolve；`import-planning` applying 无 DB 行孤儿删除；`dialog.conflicts.cancelNotice` 中英单测；`large-batch-import-reliability.test.ts` 默认 50,000 个临时小文件（可用 `SERPENT_LARGE_BATCH_COUNT` 覆盖），测完删除临时目录。
- 巨型文件拆分记为积压工单 `Serpent-43f6be`（P3），不在本轮执行。

### 本轮命令与结果

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/sqlite-in.test.ts tests/worker/pending-import-lifecycle.test.ts tests/worker/import-planning.test.ts tests/unit/i18n-translate.test.ts`：4 个测试文件通过，73 项通过，1 项跳过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/large-batch-import-reliability.test.ts`：1 个测试文件通过，1 项通过；约 50,000 个 txt 小文件导入后完成标签、合集、回收站与关库重开，耗时 391.33s。未抛 `too many SQL variables`。临时目录已删除。
- `npm run test:library-availability`：9 个测试文件通过，209 项通过，1 项跳过。
