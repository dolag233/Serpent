# 统一撤回/重做 — 双 Luna 代码审查

> 日期：2026-08-12
> 范围：统一撤回/重做基线实现及本次未提交修复
> 审查角色：两个独立 `gpt-5.6-luna` agent，分别侧重 Standards 与 Spec  兼容平台：macOS；Windows 未执行

## 结论

当前不能将 `Serpent-5n4z` 标记为 accepted。两个审查 agent 均确认了文件夹回收站撤回的根因，并确认本次修复方向正确；本轮主 agent 还修复了过期浏览请求覆盖 Undo 通知的 UI 竞态。同时仍有设计级未完成项，尤其是崩溃恢复、批量 history group 和 Windows 文件语义。

## 已修复并有回归证据的问题

1. **文件夹撤回只使用后代 tombstone**：文件夹回收站按后代优先生成 tombstone，旧代码使用 `tombstoneIds[0]`，导致撤回只恢复子目录。现在由 `rootTombstoneId` 建立历史 inverse。
2. **子树资产恢复后丢失原文件夹归属**：文件夹行删除后 `trashed_from_folder_id` 可能被置空。现在恢复资产沿 `trashed_from_tombstone_id → trashed_managed_folders → managed_folders` 重新绑定 folder ID，并覆盖 `undo → redo → undo`。
3. **批量撤回部分成功**：资产批量回收站撤回在一个目标被占用时可能只恢复其余资产，却把整条历史标为 undone。历史 replay 现在启用 `requireAll`，冲突在文件移动前返回 `ASSET_MOVE_CONFLICT`，历史进入 stale，批次保持原状态。
4. **重复撤回/重做请求重复执行或报栈错误**：已到达终态的相同 entry/direction 请求现在返回 `affectedCount: 0`，不重新执行 recipe。

## Standards 审查发现

- Windows 文件夹回收站、裸 `renameSync`、大小写-only rename、外部占用句柄、跨卷语义没有实机或 packaged 证据。
- history transition 的失败路径仍可能逐 step 执行后仅标记 stale，没有设计要求的补偿/继续收口。
- 历史容量检查存在“mutation 后才可能发现 recipe 超限”的风险，需要 admission 在前、或持久 receipt/补偿策略。
- 自动 purge 写 barrier 与用户历史可能存在并发边界，需明确 write lease 和是否应静默截断 redo。
- `App.tsx` 历史快捷键逻辑曾内联较大；本次已将 Undo/Redo 回调稳定化，但仍建议后续抽出独立 coordinator/hook。

## Spec 审查发现

- copy redo 在审查时被确认原先每次 `randomUUID()` 创建新副本，未满足“同一 ID/recipe”要求；本次已保存 source→copy identity 映射并补循环回归。
- rename/move、rating、标签实体生命周期、合集/智能合集完整生命周期、文件冲突 stale、failpoint + 完整重启对账等覆盖不完整。
- 脚本 execution 仍是多个 HistoryEntry 的逆序投影，不是一个跨多个 mutation 的统一 HistoryEntry。
- MCP/plugin/Desktop 同构 receipt 的真实完整旅程证据不足。
- 中断 attempt 当前保守标记 stale/failed，不是设计中的逐 step compensation/continue。
- 多文件夹拖入回收站及资产+文件夹混合选择仍由 Renderer 逐个提交，通知只携带最后一个 history ID；这会让一次用户批量操作只能撤回最后一项。该问题已建立 P1 `Serpent-bjm4`，需要 Worker 侧 group/atomic batch 设计。

## 本轮补充修复

- `src/renderer/App.tsx` 为并发浏览加载增加 generation fencing。文件夹移入 Trash 后，如果旧 browse 请求因文件夹已删除而返回 `FOLDER_NOT_FOUND`，该旧错误会被丢弃，不再覆盖包含 `historyEntryId` 的成功通知；最新 folder Trash E2E 1/1 通过，组合 E2E 4/4 通过。

## 验证证据

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/operation-history.integration.test.ts tests/worker/folder-delete.test.ts tests/worker/trash-relink.test.ts --reporter=dot`：3 files，108 passed，1 skipped。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/operation-history.integration.test.ts tests/worker/managed-copy.test.ts tests/worker/folder-delete.test.ts tests/worker/trash-relink.test.ts --reporter=dot`：4 files，112 passed，1 skipped。
- `node scripts/run-e2e.mjs tests/e2e/managed-move.test.ts tests/e2e/folder-recursive-scope.test.ts`：4 passed；包含 folder Trash → Undo 的 UI 回归。
- `npm run test:worker`：61 files，1013 passed，10 skipped。
- `npm run test:unit`：314 files，2421 passed，1 skipped。
- `npm run lint`、`npx tsc --noEmit --pretty false`、`git diff --check`：通过。

上述结果是 macOS 工作树自动化证据，不是 Windows 或真实桌面验收证据。

## 后续工单

继续使用：`Serpent-5n4z.3`（资产 copy/rename/move 语义）、`Serpent-5n4z.5`（文件夹 recipe）、`Serpent-5n4z.9`（崩溃恢复与 Windows）、`Serpent-5n4z.10`（大快照与容量）、`Serpent-5n4z.11`（文档/API/验收收口）。这些工单保持打开，避免把本次三个局部修复误报为整个统一历史完成。
