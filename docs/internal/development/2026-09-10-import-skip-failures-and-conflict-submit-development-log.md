# 导入冲突连点与跳过无法读取的文件（Serpent-85e60c / Serpent-7d1ba2）

## 问题

1. **内容重复窗连点**（`Serpent-85e60c`）：导入已经成功后，确认按钮没有提交锁。`resolveImport` 要跑几秒，连点会打出多次 resolve。第一次消费 pending，后续 `IMPORT_NOT_FOUND` 叠在冲突窗上；关掉后又弹出「待处理的导入已失效」。
2. **批量导入中途失败整批作废**（`Serpent-7d1ba2`）：文件夹里夹着无法读取的项（符号链接、无权限、已消失）时，整次导入抛 `INVALID_IMPORT_SOURCE`，已经能读的文件也无法入库。

## 修复

- 冲突窗 / 无法导入窗共用同步提交锁：按钮禁用、文案「正在导入…」、Escape 在提交中 hold，不放弃 token。
- `IMPORT_NOT_FOUND` 若属于已完成或非在途的重复点击，不再弹阻断错误。
- Worker 枚举/暂存时把可跳过的单文件失败记下来并暂停，弹出「无法导入部分文件」；勾选文案对齐序列帧：`将当前选择应用到后面无法导入的文件` / `Apply this choice to later files that cannot be imported`。
- 全部文件都失败、磁盘满、根目录、超长路径等仍整批失败。Eagle/Billfish 批量转换不弹窗，自动跳过。
- `asset.import.prepare` 用类型守卫区分冲突计划、无法导入计划与完成结果，避免 source-failure 被当成 conflicts。

## 验证

- `node scripts/run-vitest-with-electron.mjs run tests/unit/import-conflict-submit.test.ts tests/unit/apply-import-prepare-result.test.ts tests/unit/import-source-failure.test.ts tests/unit/dialog-escape-stack.test.ts tests/unit/protocol.test.ts tests/worker/import-planning.test.ts` — 6 files / 190 passed / 1 skipped
- Computer Use、packaged 未执行
