# 导入冲突与内容重复流程开发记录（2026-08-06）

## 范围

- 工单：`Serpent-7gvd`
- 目标：确认同名冲突与内容重复是两种独立决策流程；同名冲突提供三种选项，内容重复提供两种选项，且两类记忆偏好互不干扰。
- 当前状态：实现与定向自动化证据已补齐；人类视觉与操作验收仍待执行，工单不关闭。

## 根因定位

既有 Renderer/Worker 实现已经有独立的 `NameConflictDialog`、`ContentDuplicateDialog` 和独立偏好字段。新增 E2E 的首版测试通过 `importFilesThroughBridge` 直接调用 Preload API，再等待 Renderer 对话框；该调用只返回导入结果，不经过 `App.importAssets` 的结果分发，因此不能驱动 `presentImportConflicts`，测试接缝错误。

本轮将测试改为点击真实空库中的「导入文件」按钮，使 native dialog 的 E2E 注入路径、Renderer 状态编排和对话框渲染全部经过真实用户旅程。单批次注入两组冲突：

1. 两个不同目录下的同名文件，内容不同，触发同名冲突；
2. 两个文件内容相同，文件名不同，触发内容重复。

当两类冲突同时存在时，预期先显示同名冲突窗；确认后再显示内容重复窗。

## 文件夹拖拽递归导入（Serpent-u5w9）

核对结果：外部拖拽路径已在 Main 通过 `classifyDroppedSourcePaths` 识别为单个 `folder`，Worker 的 `enumerateImportSources` 递归读取目录并拒绝符号链接；目录导入应用统一冲突规划。`resolveImport` 对已存在的目录复用实际目标目录，因此同名目录合并，文件级同名冲突仍进入既有冲突流程。

新增 Worker 回归覆盖：目标文件夹已有同名 `Reference` 目录时，外部目录导入仍保留原目录、写入根文件和嵌套文件，不创建第二个同名目录。Finder/资源管理器真实拖拽仍需人工验收，以确认 Chromium `DataTransfer` 的目录 File 路径在 macOS 与 Windows 开发态/packaged 行为一致。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 同名冲突提供自动重命名、覆盖、跳过 | `src/renderer/NameConflictDialog.tsx:17`；`src/renderer/App.tsx:5526` | `tests/e2e/import-conflict-flows.test.ts:26`，断言 3 个 option | 2026-08-06 macOS 开发态真实 Electron E2E 通过；人类视觉验收待执行 |
| 内容重复提供跳过、仍然导入，不显示合并 | `src/renderer/ContentDuplicateDialog.tsx:17`；`src/renderer/App.tsx:5544` | `tests/e2e/import-conflict-flows.test.ts:26`，断言 2 个 option | 2026-08-06 macOS 开发态真实 Electron E2E 通过；人类视觉验收待执行 |
| 两类冲突按阶段独立出现 | `src/renderer/App.tsx:788`、`src/renderer/App.tsx:5498`；`src/worker/library-service.ts:22566` | `tests/e2e/import-conflict-flows.test.ts:26`，断言同名窗关闭后出现内容重复窗 | packaged、Windows、Computer Use 未执行 |
| 两类记忆偏好互不覆盖 | `src/renderer/import-conflict-preferences.ts:14`；`src/renderer/import-conflict-flow.ts:22` | `tests/unit/import-conflict-preferences.test.ts` | 单元/Worker 定向测试通过；人类设置页复验待执行 |

## 变更

- `tests/e2e/import-conflict-flows.test.ts`
  - 改用真实 Renderer 导入按钮，不再用直接 Preload 导入调用等待 UI 对话框。
  - 在同一批次构造同名冲突与内容重复，覆盖分阶段顺序和各自选项。
- `docs/qa/human-acceptance-checklist.md`
  - `IMPORT-007`、`IMPORT-008`、`IMPORT-009` 因 2026-08-06 用户反馈重新标为待人类验收。

## 验证证据

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/import-conflict-preferences.test.ts tests/worker/import-planning.test.ts
→ Test Files 2 passed；Tests 48 passed

node scripts/run-e2e.mjs tests/e2e/import-conflict-flows.test.ts
→ 1 passed (2.7s；macOS 开发态，SERPENT_E2E_USER_DATA_PATH 临时隔离；2026-08-06 复跑)

npm run test:worker -- tests/worker/desktop-ingestion.test.ts
→ 46 passed | 3 skipped files；809 passed | 7 skipped tests（项目 Worker 测试入口会运行整个 tests/worker 集合）
```

首次在受限沙箱中运行时，Worker 夹具写入临时 `.git/config` 被环境拒绝；同一命令在允许临时目录写入的本机环境复跑通过。首次 E2E 启动也受沙箱中的 Electron `SIGABRT` 阻断；同一真实 Electron E2E 在本机环境复跑通过。上述环境失败不作为功能失败或成功证据。

## 未完成

- 用户本人按 `IMPORT-007/008/009` 操作步骤进行视觉与交互验收，并将状态改为「人类验收通过」或记录具体失败。
- packaged、Windows 和 Computer Use 证据仍未执行。
