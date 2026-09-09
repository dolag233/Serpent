# 导入进度遮罩盖住决策对话框（Serpent-224ac8）

## 问题

导入较多文件时全屏「正在导入」遮罩会盖住同名冲突、内容重复、序列帧确认等必须回答的对话框。复制进度可以停在 100%，导入无法完成；点「取消导入」也不能退出。

## 根因

不是「这些决策问得太早」。同名/重复必须在提交前选择 keep-both / replace / skip，序列帧也宜在入库前确认。

真正的死锁是层叠与取消语义：

1. `BlockingProgressOverlay` 渲染在 `.app-shell` 外；决策对话框原来在 `.app-shell` 内。shell 使用 `isolation: isolate`，遮罩与对话框不在同一层叠上下文，遮罩永远压住决策窗。
2. `isBlockingImportOverlayVisible` 只看非终态 `import.progress`。prepare 已经返回冲突计划后，迟到的 copy 100% 事件会把遮罩重新拉起。
3. Escape 把 blocking import 排在 conflicts / sequence-import 之前。
4. `cancelImport()` 只查 `activeImports`。等待用户决策时导入已在 `pendingImports`，取消抛 `IMPORT_NOT_FOUND`，遮罩不消失。

## 修复

- 存在导入决策 UI 时隐藏阻塞进度遮罩，并忽略非终态进度事件。
- 将同名/重复/序列帧导入对话框移到 `app-shell` 外、进度遮罩之后。
- Escape：序列帧导入确认、冲突计划优先于取消导入。
- Worker `cancelImport` 对 pending 计划回落到 `abandonImport`，并发 `cancelled` 进度。
- 关闭决策 UI 时清掉残留进度，避免遮罩复活。

## 验证

- `node scripts/run-vitest-with-electron.mjs run tests/unit/import-progress-copy.test.ts tests/unit/dialog-escape-stack.test.ts tests/worker/pending-import-lifecycle.test.ts` — 3 files / 26 passed
- 2026-09-09 用户验收通过 IMPORT-UI-002（Windows 真机）
- Computer Use、packaged 未执行
