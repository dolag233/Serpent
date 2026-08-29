# 2026-08-04：Automation 文件操作计划 fencing（Serpent-y51c.8）

## 本次增量

文件操作与导入计划现在由 Worker 生成并在执行前再次计算。批准证明不再只携带变更序号和资产状态 token：

- 文件操作计划哈希包含 operation、完整 asset ID 顺序、移动目标、冲突策略、批量重命名目标、变更序号、资产 token 以及预检得到的处理决策。
- `asset.rename-files` 的每项目标文件名会完整传入只读预检和执行前校验；不会出现“批准的是一组名字、执行时只按资产 ID 猜名字”的缺口。
- 移动预检会按实际 Worker 规则计算目标冲突、批内冲突、keep-both/replace/skip 的处理结果，并返回 `conflictCount`、`executableCount` 和 `blockedCount`。
- 重命名预检会检查规范化文件名、完整文件名长度、数据库路径冲突、磁盘目录项冲突和源文件可用性。
- Worker 执行前会用同一套 intent 重新预检并比较 hash；即使数据库变更序号未变，磁盘冲突或最终目标变化也会拒绝旧批准。
- 导入计划的 `planHash` 从 Worker 计划结果透传，并在真正准备导入前重新校验；不再只校验 source token 和 change sequence。

这些检查仍不允许永久删除；实际写入继续经过现有 `file_operations` 恢复日志和执行租约。

## 验证证据

```text
npm run typecheck -- --pretty false
npx vitest run tests/unit/automation-file-plan-approval.test.ts tests/worker/import-planning.test.ts tests/worker/trash-relink.test.ts --reporter=dot
npx vitest run tests/unit/quickjs-sandbox-prototype.test.ts --reporter=dot
```

结果：文件计划/导入/回收站相关 3 个测试文件 131 tests passed、1 skipped；QuickJS 22 tests passed；typecheck 通过。新增回归覆盖文件计划 hash 被篡改、导入 hash 被篡改、批量重命名目标透传和 Host 等待不消耗 QuickJS CPU 预算。

最终合并回归：`npm run test` → 322 个测试文件通过、3 个跳过；2809 个测试通过、8 个跳过。当前提交仍未取得 packaged、Windows、Computer Use 及真实 MCP 写入旅程证据，因此相关 P1 工单继续保持 `in_progress`。

## 尚未验证

当前变更尚未取得 packaged、Windows、真实 MCP 长流程和 Computer Use 证据，不能关闭 `Serpent-y51c.8` 或相关人类验收条目。现阶段只记录为开发态自动化证据。
